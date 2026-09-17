import { Notification } from "electron";
import type { ProactiveDestination, Briefing } from "@nova/runtime";

/**
 * The `ProactiveDestination` `BackgroundAssistant` was always designed
 * around (see docs' background-assistant/proactive-briefing spec) but
 * never had a concrete desktop implementation — `runtime.ts` had nowhere
 * to send a generated briefing, so `backgroundAssistant` was simply never
 * constructed. Uses Electron's native `Notification` (OS-level toast:
 * Windows Action Center, macOS Notification Center, libnotify on Linux)
 * rather than an in-app-only banner, so a briefing surfaces even if NOVA's
 * window isn't focused — the same bar `docs/07-observers` and
 * `docs/21-channels` hold every other proactive surface to.
 *
 * One native notification is sent per briefing item rather than one
 * combined notification for the whole briefing: each item carries its
 * own `source_id` and may need independent dismissal/action, and OS
 * notification bodies are the wrong place to concatenate an unbounded
 * item list.
 */
export function createDesktopNotificationDestination(): ProactiveDestination {
  return {
    deliver: async (briefing: Briefing): Promise<void> => {
      if (!Notification.isSupported()) return;
      for (const item of briefing.items) {
        new Notification({
          title: item.title,
          body: item.summary,
          silent: false,
        }).show();
      }
    },
  };
}
