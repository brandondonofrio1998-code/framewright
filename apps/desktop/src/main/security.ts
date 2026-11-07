import { app, session, type Session } from 'electron';
import { devCsp } from '../shared/csp';
import { APP_ORIGIN, isAllowedRequest, isAppUrl } from '../shared/network-policy';

const blockedRequests: string[] = [];
let updatesEnabled = false;

export function getBlockedRequests(): readonly string[] {
  return blockedRequests;
}

export function setUpdatesEnabled(enabled: boolean): void {
  updatesEnabled = enabled;
}

function hardenSession(ses: Session, devServerOrigin: string | null): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    if (isAllowedRequest(details.url, devServerOrigin, updatesEnabled)) {
      callback({});
      return;
    }
    blockedRequests.push(details.url);
    console.warn(`[framewright] blocked outbound request: ${details.url}`);
    callback({ cancel: true });
  });

  if (devServerOrigin !== null) {
    const csp = devCsp(devServerOrigin);
    ses.webRequest.onHeadersReceived({ urls: [`${devServerOrigin}/*`] }, (details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  }

  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setSpellCheckerDictionaryDownloadURL(`${APP_ORIGIN}/no-dictionaries/`);
}

/** Must be called after `app` is ready and before any window is created. */
export function installSecurity(devServerOrigin: string | null): void {
  hardenSession(session.defaultSession, devServerOrigin);
  app.on('session-created', (ses) => hardenSession(ses, devServerOrigin));

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
    const blockForeignNavigation = (event: { preventDefault(): void }, url: string) => {
      if (!isAppUrl(url, devServerOrigin)) event.preventDefault();
    };
    contents.on('will-navigate', blockForeignNavigation);
    contents.on('will-redirect', blockForeignNavigation);
  });
}

export function isTrustedSender(frameUrl: string | undefined, devServerOrigin: string | null): boolean {
  return frameUrl !== undefined && isAppUrl(frameUrl, devServerOrigin);
}
