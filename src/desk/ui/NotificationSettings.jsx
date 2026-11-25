// "Notifications" card: browser alerts on this computer, phone alerts through the free
// ntfy app, and which desk events send an alert. compact hides the event choices.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Badge, Card, SectionLabel, BTN } from './atoms';
import { timeAgo } from './format';
import {
  loadNotifySettings, saveNotifySettings, onNotifySettings, ensureTopics, rotateTopics,
  browserPermission, requestBrowserPermission, sendTestNotification,
  lastNotifyError, onNotifyError, phoneSubscribeLink,
} from '../../lib/notify';

const PLAY_URL = 'https://play.google.com/store/apps/details?id=io.heckel.ntfy';
const APP_STORE_URL = 'https://apps.apple.com/us/app/ntfy/id1625396347';
const PRIMARY = 'px-3 py-1.5 rounded-md text-xs font-semibold bg-[#58a6ff]/15 border border-[#58a6ff]/40 text-[#58a6ff] hover:bg-[#58a6ff]/25 disabled:opacity-40 transition-colors';
const LINK = 'text-[#58a6ff] hover:underline';

const PERMISSION_BADGE = {
  granted: ['green', 'Allowed'],
  denied: ['red', 'Blocked'],
  default: ['grey', 'Not set up'],
  unsupported: ['grey', 'Not available'],
};

const EVENTS = [
  ['paperTrades', 'Paper trades the desk opens or closes'],
  ['liveTrades', 'Real trades on Coinbase (always recommended)'],
  ['signals', 'New trade signals the desk finds'],
];

function Toggle({ on, onChange, label, disabled = false }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border transition-colors disabled:opacity-40 ${
        on ? 'bg-green-500/30 border-green-500/50' : 'bg-[#21262d] border-[#30363d]'}`}>
      <span className={`inline-block h-3.5 w-3.5 rounded-full transition-transform ${on ? 'translate-x-[18px] bg-green-400' : 'translate-x-[3px] bg-[#8b949e]'}`} />
    </button>
  );
}

function Row({ title, sub, children }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm text-white">{title}</div>
        {sub && <div className="text-[11px] text-[#8b949e] mt-0.5 leading-relaxed">{sub}</div>}
      </div>
      <div className="pt-0.5">{children}</div>
    </div>
  );
}

function Step({ n, children }) {
  return (
    <li className="flex gap-2.5">
      <span className="w-5 h-5 rounded-full bg-[#21262d] text-[#8b949e] inline-flex items-center justify-center text-[10px] font-bold font-mono flex-shrink-0 mt-0.5">{n}</span>
      <div className="min-w-0 flex-1 text-xs text-[#8b949e] leading-relaxed">{children}</div>
    </li>
  );
}

// Browser permission, re-read when the visitor comes back from the browser's settings.
function usePermission() {
  const [perm, setPerm] = useState(browserPermission);
  useEffect(() => {
    const check = () => setPerm(browserPermission());
    let status = null;
    let cancelled = false;
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    navigator.permissions?.query?.({ name: 'notifications' })
      .then((s) => { if (!cancelled) { status = s; s.onchange = check; } })
      .catch(() => {});
    return () => {
      cancelled = true;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      if (status) status.onchange = null;
    };
  }, []);
  return [perm, setPerm];
}

// QR code image (data URL) for the ntfy subscribe link. The library loads only when needed.
function useQrCode(text) {
  const [qr, setQr] = useState(null);
  useEffect(() => {
    if (!text) return undefined;
    let alive = true;
    import('qrcode')
      .then((m) => (m.toDataURL ? m : m.default).toDataURL(text, {
        margin: 1, width: 256, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' },
      }))
      .then((src) => { if (alive) setQr({ text, src }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [text]);
  return qr && qr.text === text ? qr.src : null;
}

function selectText(el) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* */ }
}

function TestResult({ result }) {
  if (!result) return null;
  if (result.sending) return <div className="text-[11px] text-[#8b949e] mt-1.5">Sending…</div>;
  const where = [result.browser && 'this computer', result.phone && 'your phone'].filter(Boolean);
  return (
    <div className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed">
      {where.length > 0 && <div className="text-green-400">Sent to {where.join(' and ')}. If it did not arrive, check the steps above.</div>}
      {result.error && <div className="text-red-400">{result.error}</div>}
      {where.length === 0 && !result.error && <div className="text-orange-300">Nothing was sent. Turn on this computer or your phone above.</div>}
    </div>
  );
}

function ComputerSection({ settings, perm, setBrowser, busy }) {
  const [tone, label] = PERMISSION_BADGE[perm] ?? PERMISSION_BADGE.unsupported;
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>This computer</SectionLabel>
        <Badge tone={tone}>{label}</Badge>
      </div>
      {perm === 'default' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[#8b949e] leading-relaxed">Your browser will ask you to allow alerts from this site.</p>
          <button type="button" className={PRIMARY} onClick={() => setBrowser(true)} disabled={busy}>{busy ? 'Asking…' : 'Enable'}</button>
        </div>
      )}
      {perm === 'denied' && (
        <p className="text-xs text-[#8b949e] leading-relaxed">
          Your browser is blocking alerts from this site. To allow them, click the icon at the left of the web address,
          set Notifications to Allow, then reload this page.
        </p>
      )}
      {perm === 'unsupported' && (
        <p className="text-xs text-[#8b949e] leading-relaxed">This browser cannot show alerts from websites. Use the phone app below instead.</p>
      )}
      {perm !== 'unsupported' && (
        <Row title="Show alerts on this computer" sub="Alerts appear only while this site is open in a browser tab.">
          <Toggle label="Show alerts on this computer" on={settings.browser && perm === 'granted'} disabled={perm === 'denied' || busy} onChange={setBrowser} />
        </Row>
      )}
    </section>
  );
}

function PhoneSection({ settings }) {
  const { enabled, alertTopic } = settings.ntfy;
  const link = enabled && alertTopic ? phoneSubscribeLink(alertTopic) : null;
  const qrSrc = useQrCode(link);
  const topicRef = useRef(null);
  const [copied, setCopied] = useState('');
  const [test, setTest] = useState(null);
  const [err, setErr] = useState(lastNotifyError);

  useEffect(() => onNotifyError(setErr), []);
  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(''), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const setPhone = (on) => {
    if (on) ensureTopics();
    saveNotifySettings({ ntfy: { enabled: on } });
    setTest(null);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(alertTopic);
      setCopied('ok');
    } catch {
      selectText(topicRef.current);
      setCopied('select');
    }
  };
  const sendTest = async () => {
    setTest({ sending: true });
    setTest(await sendTestNotification());
  };
  const newChannel = () => {
    const ok = window.confirm(
      'Make a new private channel?\n\nYour phone will stop getting alerts until you subscribe to the new channel in the ntfy app. You can then delete the old one there.',
    );
    if (!ok) return;
    rotateTopics();
    setTest(null);
  };

  return (
    <section className="space-y-2.5">
      <SectionLabel>Your phone (ntfy app)</SectionLabel>
      <Row title="Send alerts to my phone" sub="Uses the free ntfy app. No account needed.">
        <Toggle label="Send alerts to my phone" on={enabled} onChange={setPhone} />
      </Row>

      {enabled && !alertTopic && (
        <button type="button" className={PRIMARY} onClick={() => ensureTopics()}>Make my private channel</button>
      )}

      {enabled && alertTopic && (
        <>
          <ol className="space-y-3 pt-1">
            <Step n={1}>
              Install the free ntfy app:{' '}
              <a className={LINK} href={PLAY_URL} target="_blank" rel="noopener noreferrer">Android (Google Play)</a>{' '}or{' '}
              <a className={LINK} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">iPhone (App Store)</a>.
            </Step>
            <Step n={2}>
              Subscribe to your private channel. Keep the server set to ntfy.sh.
              <div className="mt-2 flex flex-col sm:flex-row gap-3">
                <figure className="flex-shrink-0">
                  <div className="w-32 h-32 rounded-lg bg-white p-1.5 flex items-center justify-center">
                    {qrSrc
                      ? <img src={qrSrc} alt="QR code that subscribes the ntfy app to your channel" className="w-full h-full" />
                      : <span className="text-[10px] text-[#484f58]">Loading…</span>}
                  </div>
                  <figcaption className="text-[11px] text-[#8b949e] mt-1">Android: scan with the camera</figcaption>
                </figure>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-[#8b949e] mb-1">iPhone: open ntfy, tap +, paste this topic</div>
                  <div className="flex items-stretch gap-2">
                    <code ref={topicRef} className="flex-1 min-w-0 font-mono text-xs text-white bg-[#1c2128] border border-[#30363d] rounded-md px-2 py-1.5 break-all select-all">
                      {alertTopic}
                    </code>
                    <button type="button" className={BTN} onClick={copy}>{copied === 'ok' ? 'Copied' : 'Copy'}</button>
                  </div>
                  {copied === 'select' && <div className="text-[11px] text-orange-300 mt-1">Could not copy. The topic is selected: copy it by hand.</div>}
                  <a className={`${LINK} text-[11px] inline-block mt-2`} href={link}>On your Android phone now? Open in ntfy</a>
                </div>
              </div>
            </Step>
            <Step n={3}>Android: in ntfy, turn on <span className="text-white">Instant delivery</span> for this channel so alerts arrive without delay.</Step>
            <Step n={4}>
              Check that it works.
              <div className="mt-1.5">
                <button type="button" className={PRIMARY} onClick={sendTest} disabled={test?.sending}>Send test notification</button>
              </div>
              <TestResult result={test} />
            </Step>
          </ol>

          {!test && err && (
            <div className="text-[11px] text-red-400 leading-relaxed">Last problem ({timeAgo(err.at)}): {err.message}</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-[11px] text-[#8b949e] leading-relaxed min-w-0 flex-1">Think someone else knows your channel? Make a new one.</p>
            <button type="button" className={BTN} onClick={newChannel}>New private channel</button>
          </div>
        </>
      )}
    </section>
  );
}

function EventsSection({ settings }) {
  return (
    <section className="space-y-2.5">
      <SectionLabel>What to alert</SectionLabel>
      {EVENTS.map(([key, label]) => (
        <Row key={key} title={label}>
          <Toggle label={label} on={settings.events[key]} onChange={(on) => saveNotifySettings({ events: { [key]: on } })} />
        </Row>
      ))}
    </section>
  );
}

export default function NotificationSettings({ compact = false }) {
  const settings = useSyncExternalStore(onNotifySettings, loadNotifySettings, loadNotifySettings);
  const [perm, setPerm] = usePermission();
  const [busy, setBusy] = useState(false);

  const setBrowser = async (on) => {
    if (!on) { saveNotifySettings({ browser: false }); return; }
    setBusy(true);
    const p = perm === 'granted' ? 'granted' : await requestBrowserPermission();
    setPerm(p);
    if (p === 'granted') saveNotifySettings({ browser: true });
    setBusy(false);
  };

  return (
    <section id="notifications" className="scroll-mt-4">
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-white">Notifications</h2>
        <p className="text-xs text-[#8b949e] mt-0.5">Get an alert when the desk opens or closes a trade.</p>

        <div className="mt-4 space-y-4 divide-y divide-[#30363d] [&>*+*]:pt-4">
          <ComputerSection settings={settings} perm={perm} setBrowser={setBrowser} busy={busy} />
          <PhoneSection settings={settings} />
          {!compact && <EventsSection settings={settings} />}
          <div className="space-y-1.5 text-[11px] text-[#8b949e] leading-relaxed">
            <p>Anyone who knows your channel name could read these alerts — keep it private. Alerts never include your keys or balances.</p>
            <p>Requests to confirm a real trade always also appear on the Live page. They expire after 2 minutes: no answer means no trade.</p>
          </div>
        </div>
      </Card>
    </section>
  );
}
