import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

// Uses the same isolated API, fixtures and Chromium session as browserSmoke.
export async function checkSiteStyles({ call, evaluate, waitFor, screenshot, origin, artifacts, baseline }) {
  const routes = [
    ['login', '/login', '.auth-form', null],
    ['forgot-password', '/forgot-password', '.auth-form', null],
    ['not-found', '/missing-page', '.not-found-content', null],
    ['calendar', '/kalender', '.calendar-container', 'admin'],
    ['opkomsten', '/opkomsten', '.opkomsten-container', 'admin'],
    ['declaraties', '/declaraties', '.payment-request-form', 'admin'],
    ['strepen', '/strepen', '.strepen-page', 'admin'],
    ['account', '/account', '.account-page-container', 'admin'],
    ['developer', '/developer', '.developer-groups', 'developer'],
    ['database', '/developer/database', '.developer-database', 'developer'],
    ['developer-account', '/developer/account', '.developer-account', 'developer'],
  ]
  const settle = () => evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`)
  const signature = () => evaluate(`(() => {
    const selectors = ['.btn-primary', '.btn-secondary', '.form-input', '.form-select', '.checkbox-custom'];
    const properties = ['fontFamily', 'fontSize', 'fontWeight', 'borderRadius', 'borderWidth', 'color', 'backgroundColor', 'paddingTop', 'paddingRight', 'minHeight'];
    return Object.fromEntries(selectors.map(selector => {
      const element = [...document.querySelectorAll(selector)].find(e => e.checkVisibility() && !e.matches('.mobile-create-event-btn, .btn-compact, .form-input-compact'));
      if (!element) return [selector, null];
      const style = getComputedStyle(element);
      return [selector, Object.fromEntries(properties.map(p => [p, style[p]]))];
    }));
  })()`)
  const navigate = async (route, root, spa = false) => {
    if (spa) {
      await evaluate(`(() => {
        const link = [...document.querySelectorAll('a')].find(a => a.getAttribute('href') === ${JSON.stringify(route)} && a.checkVisibility());
        if (!link) throw Error('Navigation link missing: ${route}');
        link.click();
      })()`)
    } else await call('Page.navigate', { url: origin + route })
    await waitFor(`location.pathname === ${JSON.stringify(route)} && !!document.querySelector(${JSON.stringify(root)})`)
    await settle()
  }
  const report = []
  let actor
  for (const [name, route, root, nextActor] of routes) {
    if (nextActor && nextActor !== actor) {
      await call('Page.navigate', { url: `${origin}/__test/login/${nextActor}` })
      await waitFor(`!!document.querySelector('${nextActor === 'developer' ? '.developer-groups' : '.account-page-container'}')`)
      actor = nextActor
    }
    for (const width of [320, 390, 768, 1280]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 })
      await navigate(route, root)
      const layout = await evaluate(`(() => {
        const content = document.querySelector(${JSON.stringify(root)});
        return { overflow: document.documentElement.scrollWidth > innerWidth,
          outside: [...content.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea, button')]
            .filter(e => e.checkVisibility() && (e.getBoundingClientRect().left < -1 || e.getBoundingClientRect().right > innerWidth + 1))
            .map(e => e.getAttribute('aria-label') || e.name || e.textContent.trim()), styles: null };
      })()`)
      layout.styles = await signature()
      report.push({ name, width, ...layout })
      if (!baseline) {
        assert.equal(await evaluate(`getComputedStyle(document.body).fontFamily.includes('Inter')`), true, 'Shared font must be loaded')
        assert.equal(await evaluate(`getComputedStyle(document.body).getPropertyValue('--secondary-900').trim()`), '#0f172a', 'Design tokens must be loaded')
        assert.equal(layout.overflow, false, `${name} at ${width}px overflows`)
        assert.deepEqual(layout.outside, [], `${name} at ${width}px clips controls`)
      }
      await screenshot(`styles-${name}-${width}.png`)
      if (!baseline && nextActor && width <= 768) {
        const overlap = await evaluate(`(() => {
          const nav = document.querySelector('.bottom-nav');
          if (!nav?.checkVisibility()) return false;
          const controls = [...document.querySelector(${JSON.stringify(root)}).querySelectorAll('button, input:not([type=checkbox]):not([type=radio]), select, textarea')].filter(e => e.checkVisibility());
          const last = controls.at(-1);
          if (!last) return false;
          last.scrollIntoView({ block: 'end', behavior: 'instant' });
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
          return last.getBoundingClientRect().bottom > nav.getBoundingClientRect().top + 1;
        })()`)
        assert.equal(overlap, false, `${name} at ${width}px leaves its last control behind mobile navigation`)
        await evaluate(`window.scrollTo({ top: 0, behavior: 'instant' })`)
      }
    }
  }
  if (!baseline) {
    for (const selector of ['.btn-primary', '.form-input', '.form-select']) {
      let expected
      for (const entry of report) {
        const style = entry.styles[selector]
        if (!style) continue
        const common = Object.fromEntries(['fontFamily', 'fontSize', 'borderRadius', 'borderWidth', 'minHeight'].map(p => [p, style[p]]))
        expected ??= common
        assert.deepEqual(common, expected, `${entry.name} at ${entry.width}px has inconsistent ${selector} styling`)
      }
    }
    for (const group of [routes.filter(r => r[3] === 'admin'), routes.filter(r => r[3] === 'developer')]) {
      const currentActor = group[0][3]
      await call('Page.navigate', { url: `${origin}/__test/login/${currentActor}` })
      await waitFor(`!!document.querySelector('${currentActor === 'developer' ? '.developer-groups' : '.account-page-container'}')`)
      for (const [name, route, root] of group) {
        await navigate(route, root)
        const before = await signature()
        for (const [, otherRoute, otherRoot] of group.filter(r => r[1] !== route)) await navigate(otherRoute, otherRoot, true)
        await navigate(route, root, true)
        assert.deepEqual(await signature(), before, `${name} changes after visiting other routes`)
      }
    }
    await call('Page.navigate', { url: `${origin}/__test/login/admin` })
    await waitFor(`!!document.querySelector('.account-page-container')`)
    await navigate('/kalender', '.calendar-container')
    await evaluate(`document.querySelector('.fc-nieuwBtn-button').click()`)
    await waitFor(`!!document.querySelector('.modal-content form')`)
    await evaluate(`(() => {
      const label = [...document.querySelectorAll('.modal-content .checkbox-label')].find(e => e.textContent.trim() === 'Opkomst');
      label.querySelector('input').click();
    })()`)
    await waitFor(`!!document.querySelector('.event-guest-toggle')`)
    await evaluate(`document.querySelector('.event-guest-toggle input').click()`)
    await waitFor(`!!document.querySelector('.event-guest-name')`)
    await evaluate(`(() => {
      document.querySelector('.modal-title').textContent = 'Nieuw evenement met een lange naam voor Stam en externe opkomstmakers';
      document.querySelector('.opkomstmaker-checkbox input').click();
    })()`)
    for (const width of [320, 390, 768, 1280]) {
      await call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 })
      await settle()
      const modal = await evaluate(`(() => {
        const root = document.querySelector('.modal-content'), bounds = root.getBoundingClientRect();
        const controls = [...root.querySelectorAll('input:not([type=checkbox]), select, textarea, button')].filter(e => e.checkVisibility());
        const checkbox = root.querySelector('.opkomstmaker-checkbox input:checked + .checkbox-custom');
        const tick = getComputedStyle(checkbox, '::after');
        return { outside: controls.filter(e => { const r = e.getBoundingClientRect(); return r.left < bounds.left - 1 || r.right > bounds.right + 1 }).map(e => e.type || e.textContent), top: bounds.top, bottom: bounds.bottom,
          guestHeight: document.querySelector('.event-guest-name').getBoundingClientRect().height, tick: tick.content, transform: tick.transform, closeWidth: root.querySelector('.close-btn').getBoundingClientRect().width };
      })()`)
      assert.deepEqual(modal.outside, [], `Event modal clips controls at ${width}px`)
      assert.ok(modal.top >= 0 && modal.bottom <= 901, `Event modal exceeds viewport at ${width}px`)
      assert.equal(modal.guestHeight, 32)
      assert.equal(modal.closeWidth, 44)
      assert.ok(modal.tick.includes('✓') && modal.transform !== 'none', 'Member checkbox tick is missing or uncentered')
      await screenshot(`styles-event-dialog-${width}.png`, false)
    }
    await evaluate(`document.querySelector('.close-btn').click()`)
    await navigate('/account', '.account-page-container')
    const light = await signature()
    await call('Page.bringToFront')
    const focus = await evaluate(`(() => {
      const button = [...document.querySelectorAll('.btn:not(:disabled)')].find(e => e.checkVisibility());
      button.focus();
      return { focused: document.activeElement === button, outline: getComputedStyle(button).outlineWidth };
    })()`)
    assert.equal(focus.focused, true, 'A visible enabled button must receive keyboard focus')
    assert.equal(focus.outline, '2px')
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    assert.deepEqual(await signature(), light, 'Device dark mode changes the light theme')
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.btn')).transitionDuration.split(',').every(v => parseFloat(v) <= 0.01)`), true)
    await call('Emulation.setEmulatedMedia', { features: [] })
  }
  await writeFile(path.join(artifacts, 'styles-report.json'), JSON.stringify(report, null, 2))
  return `${baseline ? 'Baseline' : 'Verified'} all routes at four widths${baseline ? '' : ', consistent controls, route-order independence, event dialogs, mobile navigation clearance, focus and device appearance preferences'}`
}
