import { useCallback, useEffect, useState } from "react";

const DISMISS_KEY = "fafo_pwa_install_dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function InstallPromptBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, "1");
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => undefined);
    setDeferred(null);
  }, [deferred]);

  if (installed || dismissed) return null;

  if (deferred) {
    return (
      <div className="pwa-banner" role="region" aria-label="Install app">
        <div className="pwa-banner__inner">
          <div className="pwa-banner__lead">
            <div className="pwa-banner__icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3L4 7v6c0 4.5 3.5 8.2 8 9 4.5-.8 8-4.5 8-9V7l-8-4z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
            <div className="pwa-banner__title">Install FaFo Admin</div>
            <div className="pwa-banner__sub">Add to your home screen or desktop for quick access and a focused window.</div>
            </div>
          </div>
          <div className="pwa-banner__actions">
            <button type="button" className="pwa-banner__btn pwa-banner__btn--ghost" onClick={dismiss}>
              Not now
            </button>
            <button type="button" className="pwa-banner__btn pwa-banner__btn--primary" onClick={() => void install()}>
              Install app
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isIos() && !isStandalone() && !dismissed) {
    return (
      <div className="pwa-banner" role="region" aria-label="Add to Home Screen">
        <div className="pwa-banner__inner">
          <div className="pwa-banner__lead">
            <div className="pwa-banner__icon pwa-banner__icon--ios" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="5" y="3" width="14" height="18" rx="3" stroke="currentColor" strokeWidth="1.6" />
                <path d="M9 21h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
            <div>
            <div className="pwa-banner__title">Add to Home Screen</div>
            <div className="pwa-banner__sub">Tap Share, then “Add to Home Screen” to pin FaFo Admin like an app or widget-style shortcut.</div>
            </div>
          </div>
          <div className="pwa-banner__actions">
            <button type="button" className="pwa-banner__btn pwa-banner__btn--ghost" onClick={dismiss}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
