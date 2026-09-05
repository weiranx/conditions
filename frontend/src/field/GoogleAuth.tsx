import { useEffect, useRef } from "react";

interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentityApi {
  initialize: (config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce: string;
    ux_mode: "popup";
  }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      type: "standard";
      theme: "outline";
      size: "large";
      shape: "rectangular";
      text: "continue_with";
      logo_alignment: "left";
      width: number;
    },
  ) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleIdentityApi;
      };
    };
  }
}

const GOOGLE_SCRIPT_ID = "google-identity-services";
const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
let googleScriptPromise: Promise<GoogleIdentityApi> | null = null;
let googleInitializationKey: string | null = null;
let googleCredentialCallback:
  | ((response: GoogleCredentialResponse) => void)
  | null = null;

const loadGoogleIdentityApi = () => {
  if (window.google?.accounts.id)
    return Promise.resolve(window.google.accounts.id);
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const resolveApi = () => {
      if (window.google?.accounts.id) {
        resolve(window.google.accounts.id);
      } else {
        reject(new Error("Google sign-in did not initialize."));
      }
    };
    const rejectLoad = () =>
      reject(new Error("Google sign-in could not load."));
    const existing = document.getElementById(
      GOOGLE_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", resolveApi, { once: true });
      existing.addEventListener("error", rejectLoad, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_SCRIPT_ID;
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.addEventListener("load", resolveApi, { once: true });
    script.addEventListener("error", rejectLoad, { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    googleScriptPromise = null;
    document.getElementById(GOOGLE_SCRIPT_ID)?.remove();
    throw error;
  });

  return googleScriptPromise;
};

interface GoogleAuthProps {
  busy: boolean;
  clientId: string;
  nonce: string;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}

export function GoogleAuth({
  busy,
  clientId,
  nonce,
  onCredential,
  onError,
}: GoogleAuthProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  const credentialHandlerRef = useRef(onCredential);
  const errorHandlerRef = useRef(onError);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    credentialHandlerRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    errorHandlerRef.current = onError;
  }, [onError]);

  useEffect(() => {
    const buttonElement = buttonRef.current;
    if (!buttonElement) return undefined;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let activeCredentialCallback:
      | ((response: GoogleCredentialResponse) => void)
      | null = null;

    void loadGoogleIdentityApi()
      .then((api) => {
        if (disposed) return;
        const initializationKey = `${clientId}:${nonce}`;
        activeCredentialCallback = (response) => {
          if (busyRef.current) return;
          if (typeof response.credential !== "string" || !response.credential) {
            errorHandlerRef.current(
              "Google sign-in did not return a credential. Please try again.",
            );
            return;
          }
          credentialHandlerRef.current(response.credential);
        };
        googleCredentialCallback = activeCredentialCallback;
        if (googleInitializationKey !== initializationKey) {
          api.initialize({
            client_id: clientId,
            nonce,
            ux_mode: "popup",
            callback: (response) => googleCredentialCallback?.(response),
          });
          googleInitializationKey = initializationKey;
        }

        const render = () => {
          if (disposed) return;
          const width = Math.min(
            400,
            Math.max(
              240,
              Math.floor(buttonElement.getBoundingClientRect().width || 320),
            ),
          );
          buttonElement.replaceChildren();
          api.renderButton(buttonElement, {
            type: "standard",
            theme: "outline",
            size: "large",
            shape: "rectangular",
            text: "continue_with",
            logo_alignment: "left",
            width,
          });
        };

        render();
        observer = new ResizeObserver(render);
        observer.observe(buttonElement);
      })
      .catch((error) => {
        if (!disposed) {
          errorHandlerRef.current(
            error instanceof Error
              ? error.message
              : "Google sign-in could not load.",
          );
        }
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      if (googleCredentialCallback === activeCredentialCallback)
        googleCredentialCallback = null;
      buttonElement.replaceChildren();
    };
  }, [clientId, nonce]);

  return (
    <div
      className={`field-google-auth${busy ? " is-busy" : ""}`}
      aria-disabled={busy}
      ref={buttonRef}
    />
  );
}
