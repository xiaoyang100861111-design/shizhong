/* Shizhong VIP: configurable prototype thresholds, never an official Douyin tariff. */
'use strict';
(() => {
  const VERSION = '20260927-vip1';
  // Cumulative growth at each level. Interpolate whole-number thresholds between milestones.
  const anchors = [
    [1, 0],
    [2, 5],
    [3, 10],
    [4, 20],
    [5, 50],
    [6, 100],
    [7, 200],
    [8, 350],
    [9, 600],
    [10, 1000],
    [11, 1500],
    [15, 6000],
    [20, 25000],
    [25, 80000],
    [30, 200000],
    [35, 500000],
    [40, 1000000],
    [45, 2000000],
    [50, 5000000],
    [55, 10000000],
    [60, 20000000],
    [65, 40000000],
    [70, 70000000],
    [75, 100000000],
  ];
  const thresholds = Array.from({ length: 75 }, (_, i) => {
    const level = i + 1,
      upper = anchors.findIndex(a => a[0] >= level);
    if (upper === 0) return 0;
    const [highLevel, high] = anchors[upper],
      [lowLevel, low] = anchors[upper - 1];
    return Math.round(low + ((high - low) * (level - lowLevel)) / (highLevel - lowLevel));
  });
  const themes = [
    { id: 'gold', name: '荣耀金冠', level: 10, subtitle: '金色光门 · 皇冠加冕', tag: 'VIP 10 专属' },
    { id: 'rose', name: '玫瑰星雨', level: 20, subtitle: '流光花雨 · 浪漫降临', tag: 'VIP 20 解锁' },
    { id: 'cosmic', name: '星河降临', level: 35, subtitle: '星轨环绕 · 银河礼遇', tag: 'VIP 35 解锁' },
    { id: 'imperial', name: '赤金帝冠', level: 50, subtitle: '赤金华幕 · 荣耀登场', tag: 'VIP 50 解锁' },
  ];
  const defaults = {
    version: VERSION,
    baseXp: thresholds[9],
    baselineHonorXp: 0,
    entranceEnabled: true,
    theme: 'gold',
  };
  initialState.vip = { ...defaults };
  const rawXp = () => Math.max(0, Math.floor(Number(state.live?.honorXp) || 0));
  function ensure() {
    if (state.vip?.version !== VERSION) {
      state.vip = { ...defaults, baselineHonorXp: rawXp() };
      // Grant VIP10 once without changing historic gifts, funds or chat data.
      save();
    }
    return state.vip;
  }
  function progress() {
    const data = ensure(),
      xp =
        Math.max(0, Number(data.baseXp) || 1000) + Math.max(0, rawXp() - (Number(data.baselineHonorXp) || 0));
    let level = 1;
    while (level < 75 && xp >= thresholds[level]) level++;
    const start = thresholds[level - 1],
      next = level < 75 ? thresholds[level] : null;
    return {
      level,
      xp,
      start,
      next,
      gap: next === null ? 0 : Math.max(0, next - xp),
      percent: next === null ? 100 : Math.min(100, Math.max(0, ((xp - start) / (next - start)) * 100)),
    };
  }
  const number = n => Math.round(n).toLocaleString('zh-CN');
  const button = (action, id, label, cls = '', extra = '') => act('vip-' + action, id, label, cls, extra);
  const rankName = level =>
    level >= 60
      ? '璀璨传奇'
      : level >= 50
        ? '赤金荣耀'
        : level >= 35
          ? '星河尊享'
          : level >= 20
            ? '流光尊贵'
            : level >= 10
              ? '金冠贵宾'
              : '初遇之光';
  function badge() {
    const p = progress();
    return button(
      'open',
      '',
      `${icon('crown')} VIP ${p.level}`,
      'vip-account-badge',
      'aria-label="查看我的 VIP ' + p.level + ' 等级"'
    );
  }
  function progressHTML(p) {
    return `<div class="vip-progress-label"><span>${p.next === null ? '已达最高等级' : 'VIP ' + p.level + ' → VIP ' + (p.level + 1)}</span><b>${p.next === null ? '传奇荣耀' : '还差 ' + number(p.gap) + ' 成长值'}</b></div><div class="vip-progress-track" role="progressbar" aria-label="VIP 升级进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.percent)}"><i style="width:${p.percent}%"></i></div>`;
  }
  function homeCard() {
    const p = progress();
    return `<section class="vip-home-card">${button('open', '', `<span class="vip-monogram"><small>VIP</small>${p.level}</span><span class="vip-home-copy"><h3>${rankName(p.level)} <em>HONOR CLUB</em></h3><p>专属进场特效 · 等级铭牌 · 荣耀装扮</p></span>${icon('chevron')}`, 'vip-home-top', 'aria-label="打开 VIP 荣誉中心"')}${progressHTML(p)}</section>`;
  }
  function themeCards() {
    const p = progress(),
      data = ensure();
    return `<div class="vip-theme-grid">${themes.map(t => `<article class="vip-theme-card" data-theme="${t.id}"><div class="vip-theme-art"><span></span><img src="${asset('gifts/crown.png')}" alt="${esc(t.name)}" loading="lazy"><b>${p.level >= t.level ? (data.theme === t.id ? '正在佩戴' : '已解锁') : 'VIP ' + t.level + ' 解锁'}</b></div><div class="vip-theme-heading"><strong>${t.name}</strong><small>${t.subtitle}</small></div><div class="vip-theme-actions">${button('preview', t.id, '预览特效', 'vip-secondary', `aria-label="预览${t.name}进场特效"`)}${p.level >= t.level ? button('wear', t.id, data.theme === t.id ? '已佩戴' : '佩戴', 'vip-primary', `aria-pressed="${data.theme === t.id}"`) : button('rules', String(t.level), '查看等级', 'vip-secondary')}</div></article>`).join('')}</div>`;
  }
  function panelHTML(mode = 'main', focusLevel = 0) {
    const p = progress(),
      data = ensure();
    if (mode === 'rules') return rulesHTML(focusLevel);
    return `<div class="vip-content"><section class="vip-hero"><div class="vip-hero-top"><img class="avatar" src="${asset(state.profile.photo)}" alt="我的头像"><div class="vip-identity"><strong>${esc(state.profile.name)}</strong><span>适中荣誉身份 · 每份心意，都有回响</span></div></div><div class="vip-hero-level"><small>VIP</small><strong>${p.level}</strong><span>${rankName(p.level)}</span></div>${progressHTML(p)}<div class="vip-hero-foot"><span>累计成长值 <b>${number(p.xp)}</b></span>${button('rules', String(p.level), '等级规则 ›')}</div></section>
      <div class="vip-section"><h3>你的专属礼遇</h3><small>身份，让每次相遇闪耀</small></div><div class="vip-benefits">${[
        ['crown', 'VIP 等级铭牌', '直播评论与个人主页同步展示'],
        ['live', '全屏进场秀', '进入直播间，点亮专属光芒'],
        ['gift', '成长解锁装扮', '等级提升，解锁更多进场主题'],
        ['star', '一键佩戴与预览', '喜欢的风格，由你选择'],
      ]
        .map(
          ([i, title, desc]) =>
            `<div class="vip-benefit">${icon(i)}<b>${title}</b><small>${desc}</small></div>`
        )
        .join('')}</div>
      <div class="vip-section"><h3>荣耀成长之路</h3>${button('rules', String(p.level), '全部 75 级 ›')}</div><div class="vip-level-path">${[10, 20, 35, 50, 60, 75].map(level => button('rules', String(level), `<strong>V${level}</strong><span>${rankName(level)}</span><small>${number(thresholds[level - 1])}</small>`, `vip-milestone ${p.level >= level ? 'active' : 'locked'}`)).join('')}</div>
      <div class="vip-section"><h3>我的进场装扮</h3><small>已解锁 ${themes.filter(t => p.level >= t.level).length} / ${themes.length}</small></div>${themeCards()}
      <div class="vip-toggle-row"><div><strong>直播间自动展示进场特效</strong><small>每次进入播放一次，随时可以跳过</small></div>${button('toggle', '', data.entranceEnabled ? '开启' : '关闭', 'vip-switch', `role="switch" aria-checked="${!!data.entranceEnabled}" aria-label="自动展示 VIP 进场特效"`)}</div>
      <div class="vip-rules"><h3>下一份心意，点亮下一份荣耀</h3><p>直播与一对一赠礼，每使用 1 金豆，获得 1 成长值。赠礼成功后自动升级。</p>${button('gifts', '', '去直播间送礼', 'vip-primary')}<p class="vip-note">等级规则为适中原稿演示配置。你的账号已赠予 VIP10 初始身份；体验金豆余额和 RM 钱包保持独立。</p></div>
      <div class="vip-section vip-plus-link"><span>生活服务会员</span>${act('membership', '', '查看 PLUS 权益 ›')}</div></div>`;
  }
  function rulesHTML(focusLevel = 0) {
    const p = progress(),
      focus = Math.max(1, Math.min(75, Number(focusLevel) || p.level));
    const range = Math.floor((focus - 1) / 15),
      start = range * 15 + 1;
    return `<div class="vip-content"><div class="vip-section"><h3>VIP 等级与成长值</h3>${button('open', '', '返回权益 ›')}</div><div class="vip-rules"><div class="vip-rule-row"><b>当前 VIP ${p.level}</b><span>累计 ${number(p.xp)} 成长值</span></div><div class="vip-rule-row"><b>升级方式</b><span>直播 / 一对一赠礼 1 金豆 = 1 成长值</span></div><div class="vip-rule-row"><b>进场特效</b><span>VIP10、20、35、50 分别解锁 4 套主题</span></div></div><div class="vip-table-filters">${[1, 16, 31, 46, 61].map(n => button('rules', String(n), n + '–' + (n + 14), n === start ? 'active' : '', 'aria-pressed="' + (n === start) + '"')).join('')}</div><div class="vip-level-table"><div class="vip-table-row vip-table-head"><span>等级</span><span>累计成长值</span><span>距上一等级</span></div>${Array.from(
      { length: 15 },
      (_, i) => start + i
    )
      .map(
        level =>
          `<div class="vip-table-row ${level === p.level ? 'current' : ''}"><b>VIP ${level}${level === p.level ? '<small>当前</small>' : ''}</b><span>${number(thresholds[level - 1])}</span><span>${level === 1 ? '—' : '+' + number(thresholds[level - 1] - thresholds[level - 2])}</span></div>`
      )
      .join(
        ''
      )}</div><p class="vip-note">此表为适中设计原稿的等级配置，并非抖音官方价格表。赠礼预览、免费领取金豆、红包和转账不增加成长值。初始 1,000 成长值用于体验 VIP10，不代表历史消费。</p></div>`;
  }
  function show(mode = 'main', level = 0, keepScroll = false) {
    const scroll = keepScroll
      ? (document.querySelector('.lr-panel-body') || document.querySelector('.vip-screen > .vip-content'))
          ?.scrollTop || 0
      : 0;
    if (document.querySelector('.lr-room') && currentOverlay?.liveRoomId) {
      window.ShizhongLive.showVip(mode, level);
      if (keepScroll) document.querySelector('.lr-panel-body').scrollTop = scroll;
      return;
    }
    window.ShizhongVipEntry?.stop();
    const parent = currentOverlay?.returnTo;
    showScreen(mode === 'rules' ? 'VIP 等级规则' : 'VIP 荣誉中心', panelHTML(mode, level), 'vip-screen');
    currentOverlay.vipView = mode;
    if (parent) currentOverlay.returnTo = parent;
    if (keepScroll) document.querySelector('.vip-screen > .vip-content').scrollTop = scroll;
  }
  function commit(fn) {
    const before = JSON.parse(JSON.stringify(state));
    fn();
    if (save()) return true;
    state = before;
    return false;
  }
  function entry(container, preview = false, themeId = '') {
    const p = progress(),
      data = ensure();
    if (!container?.isConnected || (!preview && (!data.entranceEnabled || p.level < 10))) return;
    const requested = themes.find(t => t.id === (themeId || data.theme)) || themes[0];
    const theme = preview || p.level >= requested.level ? requested : themes[0];
    window.ShizhongLiveEffects?.stop();
    window.ShizhongOrientalEffects?.stop();
    window.ShizhongVipEntry?.play({
      container,
      level: preview ? Math.max(p.level, theme.level) : p.level,
      name: state.profile.name,
      avatar: asset(state.profile.photo),
      crown: asset('gifts/crown.png'),
      theme: theme.id,
      preview,
    });
  }
  function afterGift(before) {
    const p = progress();
    if (p.level > before) toast('恭喜升级 VIP ' + p.level + ' · ' + rankName(p.level));
  }
  const previous = menuAction;
  menuAction = function (action, id, element) {
    if (!action.startsWith('vip-')) return previous(action, id, element);
    switch (action) {
      case 'vip-open':
        return show();
      case 'vip-rules':
        return show('rules', id);
      case 'vip-preview': {
        const room = document.querySelector('.lr-room');
        if (room) {
          menuAction('lr-panel-close');
          return entry(room, true, id);
        }
        return entry(document.querySelector('.vip-screen'), true, id);
      }
      case 'vip-wear': {
        const t = themes.find(t => t.id === id);
        if (!t || progress().level < t.level) return;
        if (
          commit(() => {
            ensure().theme = id;
          })
        ) {
          render();
          show('main', 0, true);
          toast('已佩戴「' + t.name + '」进场装扮');
        }
        return;
      }
      case 'vip-toggle':
        if (
          commit(() => {
            ensure().entranceEnabled = !ensure().entranceEnabled;
          })
        ) {
          show('main', 0, true);
          render();
        }
        return;
      case 'vip-gifts':
        if (document.querySelector('.lr-room')) return menuAction('lr-gifts');
        if (currentOverlay) delete currentOverlay.returnTo;
        closeOverlay();
        return navigate('live');
    }
  };
  ensure();
  window.ShizhongVIP = Object.freeze({
    progress,
    level: () => progress().level,
    badge,
    homeCard,
    panelHTML,
    entry,
    afterGift,
    thresholds: Object.freeze(thresholds.slice()),
  });
  if (ui.page === 'me') render();
})();
