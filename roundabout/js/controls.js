/**
 * Input: the HUD's buttons and sheets and the one keyboard table (ui.keyAction), mapped onto the app's commands.
 * Creates the HUD, since its handlers are this mapping.
 *
 *   const controls = createControls(app)  ->  { hud, dispose() }
 *   app: { screen, run, view (read when used), start(), retry(), retryAs(mode), newRoundabout(), preview(),
 *          setTier(t), setTraffic(level), setDrill(key|null), setSeed(text), setTips(mode), setSound(on), muted }
 *
 * The keydown listener runs in the capture phase, before base.js's: it keeps Home (1) from leaving a live run,
 * stops a focused button's own Space/Enter click, and leaves typing in the seed field alone.
 */
import { createHud } from './hud.js';
import { keyAction } from './ui.js';

const LOOK_KEYS = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'up' };

export function createControls(app) {
  const act = () => app.run?.act();
  const actions = {
    start: () => app.start(),
    go: act,
    exit: act,
    replay: () => app.run?.showReplay(),
    replayAgain: () => app.run?.replayAgain(),
    seeAnalysis: () => app.run?.continue(),
    keepDriving: () => app.run?.keepDriving(),
    retry: () => app.retry(),
    retryGuided: () => app.retryAs('guided'),
    watch: () => app.retryAs('watch'),
    new: () => app.newRoundabout(),
    mute: () => app.setSound(app.muted),
    settings: () => hud.sheet(hud.openSheet === 'settings' ? null : 'settings'),
    close: () => hud.sheet(null),
    pause: () => {
      const { run } = app;
      if (!run) return;
      const was = run.state === 'paused';
      const now = run.togglePause();
      if (now !== was) hud.paused(now); // a state that cannot pause leaves the chip alone
    },
  };

  const hud = createHud({
    onTier: (t) => app.setTier(t),
    onShuffle: actions.new,
    onStart: actions.start,
    onAct: act,
    onRetry: actions.retry,
    onRetryMode: (mode) => app.retryAs(mode),
    onNew: actions.new,
    onChangeTier: () => app.preview(),
    onShowReplay: actions.replay,
    onReplayAgain: actions.replayAgain,
    onReplayView: () => hud.replayView(app.view.toggleDriverView()),
    onReplayNext: actions.seeAnalysis,
    onKeepDriving: actions.keepDriving,
    onMute: actions.mute,
    onSound: (on) => app.setSound(on),
    onTips: (mode) => app.setTips(mode),
    onTraffic: (level) => app.setTraffic(level),
    onDrill: (drill) => app.setDrill(drill),
    onSeed: (text) => app.setSeed(text),
    onCopyLink: () => window._base.copyText(location.href, () => hud.copied()),
  });

  function onKeyDown(e) {
    if (e.target.closest?.('input, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const { screen, run } = app;
    const look = LOOK_KEYS[e.key];
    if (look && screen === 'run' && !hud.openSheet) { app.view.held.add(look); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (e.key === '1' && screen === 'run') { e.stopImmediatePropagation(); return; }
    const where = run?.state === 'replay' ? 'replay' : run?.state === 'frozen' ? 'frozen' : screen;
    const name = keyAction(e.key, { screen: where, phase: run?.player.phase, sheet: hud.openSheet, repeat: e.repeat });
    if (!name && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); return; }
    if (!name) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    actions[name]();
  }
  function onKeyUp(e) { if (LOOK_KEYS[e.key]) app.view.held.delete(LOOK_KEYS[e.key]); }

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp);
  window._base.onKey({}); // the site's built-ins: t (theme) and 1 (Home, held back above during a run)

  return {
    hud,
    dispose() {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp);
    },
  };
}
