import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { BrowserWindow } from "electron";
import { generatePkcePair, GoogleOAuthClient, type StoredGoogleTokens } from "@nova/runtime";

/**
 * Drives the interactive half of Google's installed-app OAuth2 + PKCE
 * flow: opens a consent BrowserWindow, listens on an ephemeral loopback
 * port for Google's redirect, and captures the resulting authorization
 * code. Everything token-exchange-related (turning that code into
 * access/refresh tokens, and later refreshing them) is `GoogleOAuthClient`
 * in @nova/runtime — this file's only job is the parts that genuinely
 * require Electron: showing UI and receiving an HTTP redirect.
 *
 * A loopback redirect (`http://127.0.0.1:<port>/callback`) is used rather
 * than a custom URL scheme because it needs no OS-level protocol
 * registration and is Google's own documented redirect type for desktop
 * apps — the consent screen and the redirect both stay entirely on-device.
 */

export interface GoogleConsentFlowOptions {
  readonly clientId: string;
}

export interface GoogleConsentFlowResult {
  readonly tokens: StoredGoogleTokens;
}

export class GoogleConsentCancelledError extends Error {
  public constructor() {
    super("Google sign-in was cancelled before consent completed.");
    this.name = "GoogleConsentCancelledError";
  }
}

/** Starts a loopback HTTP server on an OS-assigned free port and resolves with the port once listening. */
function startLoopbackServer(
  onCode: (code: string, state: string) => void,
  onError: (message: string) => void,
): { server: Server; portPromise: Promise<number> } {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (error || !code || !state) {
      response.end("<html><body>Sign-in was not completed. You can close this window.</body></html>");
      onError(error ?? "Google did not return an authorization code.");
      return;
    }
    response.end("<html><body>Sign-in complete — you can close this window and return to NOVA.</body></html>");
    onCode(code, state);
  });
  const portPromise = new Promise<number>((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") resolve(address.port);
      else reject(new Error("Loopback OAuth server failed to bind a port."));
    });
  });
  return { server, portPromise };
}

/**
 * Runs the full interactive consent flow and returns freshly-issued
 * tokens. Rejects with `GoogleConsentCancelledError` if the user closes
 * the consent window before completing sign-in, and with a plain `Error`
 * for any transport/exchange failure.
 */
export async function runGoogleConsentFlow(
  options: GoogleConsentFlowOptions,
): Promise<GoogleConsentFlowResult> {
  const pkce = generatePkcePair();
  const expectedState = randomUUID();

  return await new Promise<GoogleConsentFlowResult>((resolve, reject) => {
    let settled = false;
    let client: GoogleOAuthClient | undefined;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };

    const { server, portPromise } = startLoopbackServer(
      (code, state) => {
        void (async () => {
          try {
            if (state !== expectedState) {
              throw new Error("OAuth state mismatch — the redirect did not match this sign-in attempt.");
            }
            if (!client) throw new Error("OAuth client was not initialized before the redirect arrived.");
            const tokens = await client.exchangeCodeForTokens(code, pkce.verifier);
            finish(() => resolve({ tokens }));
          } catch (cause) {
            finish(() => reject(cause instanceof Error ? cause : new Error(String(cause))));
          } finally {
            server.close();
            if (!consentWindow.isDestroyed()) consentWindow.close();
          }
        })();
      },
      (message) => {
        finish(() => reject(new Error(message)));
        server.close();
        if (!consentWindow.isDestroyed()) consentWindow.close();
      },
    );

    const consentWindow = new BrowserWindow({
      width: 480,
      height: 640,
      title: "Sign in to Google",
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    consentWindow.on("closed", () => {
      server.close();
      finish(() => reject(new GoogleConsentCancelledError()));
    });

    void portPromise
      .then((port) => {
        // The redirect_uri's port is only known once the loopback server is
        // bound, so the client (and the authorization URL it builds) is
        // constructed here rather than up front — Google requires the
        // redirect_uri in the auth request to exactly match the one used
        // at token-exchange time, so both must come from the same client.
        client = new GoogleOAuthClient({
          clientId: options.clientId,
          redirectUri: `http://127.0.0.1:${port}/callback`,
        });
        const authorizationUrl = client.buildAuthorizationUrl(pkce, expectedState);
        void consentWindow.loadURL(authorizationUrl);
      })
      .catch((cause: unknown) => {
        finish(() => reject(cause instanceof Error ? cause : new Error(String(cause))));
      });
  });
}
