// One-time card asking whether to turn on trade alerts. Shown until the visitor
// answers once (settings.prompted), then never again in this browser.
import { useState, useSyncExternalStore } from 'react';
import { Card, BTN } from '../desk/ui/atoms';
import {
  loadNotifySettings, onNotifySettings, saveNotifySettings, browserPermission, requestBrowserPermission,
} from '../lib/notify';

const PRIMARY = 'px-3 py-1.5 rounded-md text-xs font-semibold bg-[#58a6ff]/15 border border-[#58a6ff]/40 text-[#58a6ff] hover:bg-[#58a6ff]/25 disabled:opacity-40 transition-colors';

export default function NotifyPrompt() {
  const settings = useSyncExternalStore(onNotifySettings, loadNotifySettings, loadNotifySettings);
  const [busy, setBusy] = useState(false);

  const canBrowser = browserPermission() !== 'unsupported';
  const canPhone = typeof fetch === 'function'; // phone alerts go through ntfy.sh with a plain request
  if (settings.prompted || (!canBrowser && !canPhone)) return null;

  const enable = async () => {
    setBusy(true);
    const perm = canBrowser ? await requestBrowserPermission() : 'unsupported';
    saveNotifySettings(perm === 'granted' ? { prompted: true, browser: true } : { prompted: true });
    window.location.hash = '#/paper?settings=notifications';
  };
  const notNow = () => saveNotifySettings({ prompted: true });

  return (
    <div role="dialog" aria-labelledby="notify-prompt-title"
      className="fixed z-30 bottom-4 left-4 right-4 sm:left-auto sm:w-80">
      <Card className="p-4 shadow-xl shadow-black/50">
        <div id="notify-prompt-title" className="text-sm font-semibold text-white">Turn on notifications?</div>
        <p className="text-xs text-[#8b949e] mt-1 leading-relaxed">
          {canBrowser
            ? 'Get an alert when the desk opens or closes a trade — on this computer, and on your phone with the free ntfy app.'
            : 'Get an alert on your phone when the desk opens or closes a trade, with the free ntfy app.'}
        </p>
        <div className="flex justify-end gap-2 mt-3">
          <button type="button" className={BTN} onClick={notNow} disabled={busy}>Not now</button>
          <button type="button" className={PRIMARY} onClick={enable} disabled={busy}>{busy ? 'Asking…' : 'Enable'}</button>
        </div>
      </Card>
    </div>
  );
}
