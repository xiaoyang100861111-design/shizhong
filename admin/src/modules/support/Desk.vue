<template>
  <div class="page desk-page">
    <div class="page-head">
      <h1>{{ t('desk.title') }}</h1>
      <el-tag size="small" :type="connected ? 'success' : 'info'">{{ connected ? t('desk.live') : t('desk.offline') }}</el-tag>
    </div>
    <div class="desk">
      <aside class="desk-list panel">
        <el-radio-group v-model="filters.kind" size="small" class="desk-kinds" @change="loadList">
          <el-radio-button v-for="k in kinds" :key="k" :value="k">{{ t('desk.kind.' + k) }}</el-radio-button>
        </el-radio-group>
        <div class="desk-filters">
          <el-select v-model="filters.status" size="small" style="width: 100px" @change="loadList">
            <el-option v-for="s in ['open', 'closed', 'all']" :key="s" :value="s" :label="t('desk.status.' + s)" />
          </el-select>
          <el-input v-model="filters.q" size="small" :placeholder="t('desk.search')" clearable @keyup.enter="loadList" @clear="loadList" />
        </div>
        <el-checkbox v-model="filters.mine" size="small" @change="loadList">{{ t('desk.mine') }}</el-checkbox>
        <div v-loading="listLoading" class="desk-convs">
          <p v-if="!convs.length" class="muted center">{{ t('desk.noChats') }}</p>
          <button v-for="c in convs" :key="c.id" type="button" class="desk-conv" :class="{ active: current?.id === c.id }" @click="select(c)">
            <el-badge :value="c.unread" :hidden="!c.unread" :max="99">
              <el-avatar :size="38" :src="assetUrl(c.member?.avatar)">{{ (c.member?.name || '?').slice(0, 1) }}</el-avatar>
            </el-badge>
            <span class="desk-conv-main">
              <span class="desk-conv-head">
                <b>{{ c.member?.name || '—' }}</b>
                <el-tag size="small" :type="c.kind === 'support' ? 'danger' : c.kind === 'persona' ? 'warning' : 'info'">{{ c.kind === 'persona' ? c.persona?.name : t('desk.kind.' + c.kind) }}</el-tag>
              </span>
              <small class="muted desk-conv-last">{{ c.last?.fromMember ? '' : '↳ ' }}{{ c.last?.text || t('desk.msg.' + (c.last?.type || 'system'), {}) }}</small>
              <small class="muted num">{{ dateTime(c.lastAt) }}<template v-if="c.status === 'closed'"> · {{ t('desk.status.closed') }}</template></small>
            </span>
          </button>
        </div>
        <Pager v-if="total > size" :list="pagerList" />
      </aside>
      <section class="desk-chat panel">
        <div v-if="!current" class="desk-empty muted">{{ t('desk.empty') }}</div>
        <template v-else>
          <header class="desk-head">
            <el-avatar :size="40" :src="assetUrl(current.member?.avatar)">{{ (current.member?.name || '?').slice(0, 1) }}</el-avatar>
            <div class="desk-head-main">
              <b>{{ current.member?.name }}</b>
              <small class="muted">ID {{ current.member?.displayId }} <el-tag v-if="current.member?.online" size="small" type="success">{{ t('desk.online') }}</el-tag></small>
              <small v-if="current.assignedName" class="muted">{{ t('desk.assigned', { name: current.assignedName }) }}</small>
            </div>
            <el-button v-if="can('users.view') && current.member" size="small" @click="$router.push('/users/' + current.member.id)">{{ t('desk.viewMember') }}</el-button>
            <el-button v-if="canReply" size="small" @click="assign">{{ current.assignedTo ? t('desk.unassign') : t('desk.assign') }}</el-button>
            <el-button v-if="canReply" size="small" :type="current.status === 'open' ? 'warning' : 'success'" @click="toggleStatus">{{ current.status === 'open' ? t('desk.close') : t('desk.reopen') }}</el-button>
          </header>
          <div ref="logEl" class="desk-log">
            <el-button v-if="more" size="small" text class="desk-older" @click="loadOlder">{{ t('desk.older') }}</el-button>
            <div v-for="m in messages" :key="m.id" class="desk-msg" :class="{ mine: !m.fromMember && m.type !== 'system', sys: m.type === 'system' }">
              <template v-if="m.type === 'system'"><span class="desk-sys">{{ systemText(m) }}</span></template>
              <template v-else>
                <div class="desk-bubble">
                  <el-image v-if="m.type === 'image' && m.media" :src="assetUrl(m.media)" class="desk-img" fit="cover" :preview-src-list="[assetUrl(m.media)]" preview-teleported />
                  <audio v-else-if="m.type === 'voice' && m.media" :src="assetUrl(m.media)" controls preload="none" />
                  <a v-else-if="m.type === 'file' && m.media" :href="assetUrl(m.media)" target="_blank" rel="noopener">📎 {{ m.name }}</a>
                  <span v-else class="pre">{{ bodyText(m) }}</span>
                </div>
                <small class="muted desk-meta">
                  {{ m.fromMember ? t('desk.fromMember') : m.operator || (m.desk ? t('desk.desk') : m.author || t('desk.persona')) }} · {{ dateTime(m.time, true) }}
                </small>
              </template>
            </div>
          </div>
          <footer v-if="canReply" class="desk-compose">
            <small class="muted">{{ replyingAs }}</small>
            <el-input v-model="draft" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" maxlength="2000" :placeholder="t('desk.placeholder')" @keydown.enter="onEnter" />
            <div class="desk-actions">
              <el-dropdown trigger="click" @command="q => (draft = q)">
                <el-button size="small">{{ t('desk.quick') }}</el-button>
                <template #dropdown><el-dropdown-menu><el-dropdown-item v-for="q in quick" :key="q" :command="q">{{ q }}</el-dropdown-item></el-dropdown-menu></template>
              </el-dropdown>
              <el-button size="small" :loading="uploading" @click="fileEl.click()">{{ t('desk.image') }}</el-button>
              <input ref="fileEl" type="file" accept="image/*" hidden @change="sendImage" />
              <span class="spacer" />
              <el-button type="primary" :loading="sending" :disabled="!draft.trim()" @click="send">{{ t('desk.send') }}</el-button>
            </div>
          </footer>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, assetUrl, token } from '../../core/api';
import { t } from '../../core/i18n';
import { can, scope } from '../../core/auth';
import { dateTime } from '../../core/format';
import Pager from '../../components/Pager.vue';

const kinds = scope.isMerchant ? ['merchant'] : ['all', 'support', 'persona', 'merchant'];
const filters = reactive({ kind: kinds[0], status: 'open', q: '', mine: false });
const convs = ref([]);
const total = ref(0);
const size = 50;
const page = ref(1);
const listLoading = ref(false);
const current = ref(null);
const messages = ref([]);
const more = ref(false);
const draft = ref('');
const sending = ref(false);
const uploading = ref(false);
const quick = ref([]);
const logEl = ref();
const fileEl = ref();
const connected = ref(false);
const canReply = computed(() => can('support.reply') || (scope.isMerchant && can('shop.chat')));
const pagerList = { page, pageSize: ref(size), total, load: () => loadList(false), search: () => loadList() };
const replyingAs = computed(() =>
  current.value?.kind === 'persona' ? t('desk.asPersona', { name: current.value.persona?.name }) : current.value?.kind === 'merchant' ? t('desk.asMerchant') : t('desk.asDesk')
);

async function loadList(reset = true) {
  if (reset) page.value = 1;
  listLoading.value = true;
  try {
    const res = await api.get('support/conversations', {
      kind: filters.kind === 'all' ? '' : filters.kind, status: filters.status === 'all' ? '' : filters.status, q: filters.q, mine: filters.mine || '', page: page.value, size,
    });
    convs.value = res.items;
    total.value = res.total;
    if (current.value) {
      const fresh = res.items.find(c => c.id === current.value.id);
      if (fresh) Object.assign(current.value, fresh, { unread: 0 });
    }
  } finally {
    listLoading.value = false;
  }
}
function scrollDown() {
  nextTick(() => {
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight;
  });
}
async function select(c) {
  current.value = { ...c };
  messages.value = [];
  const res = await api.get(`support/conversations/${c.id}/messages`);
  messages.value = res.items;
  more.value = res.more;
  scrollDown();
  if (c.unread) {
    c.unread = 0;
    api.post(`support/conversations/${c.id}/read`).catch(() => {});
  }
}
async function loadOlder() {
  const first = messages.value[0];
  if (!first) return;
  const res = await api.get(`support/conversations/${current.value.id}/messages`, { before: first.dbId });
  messages.value = [...res.items, ...messages.value];
  more.value = res.more;
}
function onEnter(e) {
  if (e.shiftKey || e.isComposing) return;
  e.preventDefault();
  send();
}
async function send() {
  const text = draft.value.trim();
  if (!text || !current.value) return;
  sending.value = true;
  try {
    await api.post(`support/conversations/${current.value.id}/reply`, { type: 'text', text });
    draft.value = '';
    await refreshCurrent();
  } finally {
    sending.value = false;
  }
}
async function sendImage(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || !current.value) return;
  uploading.value = true;
  try {
    const up = await api.upload(file, 'chat');
    const size = await new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = URL.createObjectURL(file);
    });
    await api.post(`support/conversations/${current.value.id}/reply`, { type: 'image', media: up.ref, ...size });
    await refreshCurrent();
  } finally {
    uploading.value = false;
  }
}
async function refreshCurrent() {
  if (!current.value) return;
  const res = await api.get(`support/conversations/${current.value.id}/messages`);
  messages.value = res.items;
  more.value = res.more;
  scrollDown();
}
async function assign() {
  await api.post(`support/conversations/${current.value.id}/assign`, { adminId: current.value.assignedTo ? 0 : null });
  await loadList(false);
}
async function toggleStatus() {
  await api.post(`support/conversations/${current.value.id}/status`, { status: current.value.status === 'open' ? 'closed' : 'open' });
  ElMessage.success(t('common.done'));
  await loadList(false);
}

const money = cents => (Number(cents || 0) / 100).toFixed(2);
function bodyText(m) {
  if (m.type === 'recalled') return t('desk.recalled') + (m.recalledText ? ' ' + m.recalledText : '');
  switch (m.type) {
    case 'text':
    case 'emoji':
      return m.text;
    case 'voice':
      return t('desk.msg.voice', { n: m.duration || 1 });
    case 'image':
      return t('desk.msg.image');
    case 'file':
      return t('desk.msg.file', { name: m.name || '' });
    case 'location':
      return t('desk.msg.location', { name: `${m.name || ''} ${m.address || ''}` });
    case 'contact':
      return t('desk.msg.contact', { name: m.name || '' });
    case 'gift':
      return t('desk.msg.gift', { text: m.text || '' });
    case 'envelope':
    case 'transfer':
      return t('desk.msg.' + m.type, { amount: money(m.cents), status: t('desk.money.' + (m.status || 'pending')) });
    case 'call':
      return t('desk.msg.call', { kind: t(m.video ? 'desk.call.video' : 'desk.call.voice'), outcome: t('desk.call.' + (m.outcome || 'ended'), { n: m.duration || 0 }) });
    default:
      return m.text || m.type;
  }
}
const systemText = m => m.text || m.sys?.key || '';

// ------------------------------------------------------------------ realtime (admin hub)
let conn = null;
function loadSignalR() {
  if (window.signalR) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/signalr-8.min.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
}
let listTimer = 0;
async function connect() {
  try {
    await loadSignalR();
    conn = new window.signalR.HubConnectionBuilder()
      .withUrl('/hubs/admin/support', { accessTokenFactory: () => token.get() })
      .withAutomaticReconnect()
      .configureLogging(window.signalR.LogLevel.Warning)
      .build();
    conn.on('evt', (name, payload) => {
      if (name !== 'desk:message' && name !== 'desk:ping') return;
      if (current.value && payload?.conversationId === current.value.id && payload.message) {
        const m = payload.message;
        if (!messages.value.some(x => x.id === m.id)) {
          const fromMember = !!m.person && m.person === current.value.member?.publicId;
          messages.value.push({ ...m, fromMember, dbId: Number(String(m.id).slice(1)) });
          scrollDown();
          if (fromMember) api.post(`support/conversations/${current.value.id}/read`).catch(() => {});
        } else refreshCurrent();
      }
      clearTimeout(listTimer);
      listTimer = setTimeout(() => loadList(false), 400);
    });
    conn.onreconnected(() => (connected.value = true));
    conn.onclose(() => (connected.value = false));
    await conn.start();
    connected.value = true;
  } catch (_) {
    connected.value = false;
  }
}
onMounted(async () => {
  loadList();
  api.get('support/quick-replies').then(q => (quick.value = q || [])).catch(() => {});
  connect();
});
onBeforeUnmount(() => {
  clearTimeout(listTimer);
  conn?.stop().catch(() => {});
});
</script>

<style scoped>
.desk { display: grid; grid-template-columns: 340px 1fr; gap: 16px; height: calc(100vh - 150px); min-height: 480px; }
.desk-list, .desk-chat { margin: 0; display: flex; flex-direction: column; min-height: 0; }
.desk-kinds { margin-bottom: 8px; }
.desk-filters { display: flex; gap: 6px; margin-bottom: 6px; }
.desk-convs { flex: 1; overflow-y: auto; margin-top: 8px; }
.desk-conv { display: flex; gap: 10px; width: 100%; text-align: left; border: 0; background: none; padding: 8px; border-radius: 8px; cursor: pointer; color: inherit; }
.desk-conv:hover { background: var(--el-fill-color-light); }
.desk-conv.active { background: var(--el-color-primary-light-9); }
.desk-conv-main { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 2px; }
.desk-conv-head { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
.desk-conv-last { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.desk-empty { margin: auto; }
.desk-head { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--el-border-color-lighter); }
.desk-head-main { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.desk-log { flex: 1; overflow-y: auto; padding: 12px 4px; display: flex; flex-direction: column; gap: 10px; }
.desk-older { align-self: center; }
.desk-msg { display: flex; flex-direction: column; align-items: flex-start; max-width: 75%; }
.desk-msg.mine { align-self: flex-end; align-items: flex-end; }
.desk-msg.sys { align-self: center; max-width: 90%; }
.desk-sys { font-size: 12px; color: var(--el-text-color-secondary); background: var(--el-fill-color-light); padding: 2px 10px; border-radius: 10px; }
.desk-bubble { background: var(--el-fill-color-light); padding: 8px 12px; border-radius: 12px; word-break: break-word; }
.desk-msg.mine .desk-bubble { background: var(--el-color-primary-light-9); }
.desk-img { max-width: 220px; max-height: 220px; border-radius: 8px; }
.desk-meta { margin-top: 2px; font-size: 11px; }
.desk-compose { border-top: 1px solid var(--el-border-color-lighter); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.desk-actions { display: flex; gap: 8px; align-items: center; }
.desk-actions .spacer { flex: 1; }
.pre { white-space: pre-wrap; }
.center { text-align: center; }
@media (max-width: 900px) {
  .desk { grid-template-columns: 1fr; height: auto; }
  .desk-convs { max-height: 320px; }
  .desk-chat { min-height: 520px; }
}
</style>
