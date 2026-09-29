<template>
  <div class="page">
    <div class="page-head">
      <h1>{{ t('live.rooms') }}</h1>
      <el-radio-group v-model="list.filters.status" @change="list.search">
        <el-radio-button value="live">{{ t('live.now') }}</el-radio-button>
        <el-radio-button value="ended">{{ t('live.history') }}</el-radio-button>
        <el-radio-button value="">{{ t('live.all') }}</el-radio-button>
      </el-radio-group>
      <div class="spacer" />
      <el-button :icon="IconRefresh" @click="list.load">{{ t('common.refresh') }}</el-button>
    </div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('live.q')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe @row-click="openDetail">
        <el-table-column :label="t('live.host')" min-width="170">
          <template #default="{ row }"><UserCell :id="row.host.id" :name="row.host.name" :avatar="row.host.avatar" :display-id="row.host.displayId" /></template>
        </el-table-column>
        <el-table-column :label="t('live.title')" min-width="190">
          <template #default="{ row }"><b>{{ row.title }}</b><div class="muted">{{ row.topic }}</div></template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.status === 0" type="danger" size="small" effect="dark">{{ t('live.live') }}</el-tag>
            <el-tag v-else size="small" type="info">{{ t('live.reason.' + (row.endReason || 'host')) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('live.started')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.startedAt) }}</span></template></el-table-column>
        <el-table-column :label="t('live.duration')" width="90"><template #default="{ row }"><span class="num">{{ duration(row) }}</span></template></el-table-column>
        <el-table-column :label="t('live.viewersNow') + ' / ' + t('live.peak')" width="120" align="right">
          <template #default="{ row }"><span class="num">{{ row.status === 0 ? row.viewersNow : '—' }} / {{ row.peakViewers }}</span></template>
        </el-table-column>
        <el-table-column :label="t('live.gifts')" align="right" width="110"><template #default="{ row }"><span class="num">{{ number(row.giftBeans) }}</span></template></el-table-column>
        <el-table-column :label="t('live.income')" align="right" width="110"><template #default="{ row }"><span class="num">{{ money(row.income) }}</span></template></el-table-column>
        <el-table-column :label="t('common.actions')" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openDetail(row)">{{ t('common.detail') }}</el-button>
            <el-button v-if="row.status === 0" v-can="'live.manage'" link type="danger" @click.stop="stop(row)">{{ t('live.stop') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>

    <el-drawer v-model="drawer" :title="t('live.detail')" size="560px" @closed="stopWatch">
      <div v-if="detail" class="detail">
        <div class="head">
          <UserCell :id="detail.session.host.id" :name="detail.session.host.name" :avatar="detail.session.host.avatar" :display-id="detail.session.host.displayId" :size="40" />
          <div class="spacer" />
          <el-button v-if="detail.session.status === 0" type="primary" :icon="IconVideoPlay" @click="watch">{{ t('live.watch') }}</el-button>
          <el-button v-if="detail.session.status === 0" v-can="'live.manage'" type="danger" @click="stop(detail.session)">{{ t('live.stop') }}</el-button>
        </div>
        <h3>{{ detail.session.title }} <small class="muted">{{ detail.session.topic }}</small></h3>
        <div v-if="watching" class="player">
          <video ref="video" autoplay playsinline controls muted />
          <p v-if="watchNote" class="muted note">{{ watchNote }}</p>
        </div>
        <div class="grid-cards">
          <StatCard :label="t('live.viewersNow')" :value="detail.session.viewersNow" />
          <StatCard :label="t('live.peak')" :value="detail.session.peakViewers" />
          <StatCard :label="t('live.likes')" :value="detail.session.likes" />
          <StatCard :label="t('live.gifts')" :value="detail.session.giftBeans" />
          <StatCard :label="t('live.comments')" :value="detail.session.comments" />
          <StatCard :label="t('live.income')" :value="detail.session.income" unit="RM" />
        </div>
        <p class="muted">{{ t('live.publishing', { n: detail.publishing }) }}<span v-if="detail.session.stopNote"> · {{ detail.session.stopNote }}</span></p>
        <h4>{{ t('live.topGifters') }}</h4>
        <el-table :data="detail.gifters" size="small">
          <el-table-column :label="t('common.user')"><template #default="{ row }"><UserCell :id="row.userId" :name="row.name" :avatar="row.avatar" :display-id="row.displayId" :size="24" /></template></el-table-column>
          <el-table-column :label="t('live.beans')" align="right" width="110"><template #default="{ row }"><span class="num">{{ number(row.beans) }}</span></template></el-table-column>
          <el-table-column :label="t('live.times')" align="right" width="70" prop="times" />
        </el-table>
        <h4>{{ t('live.recentComments') }}</h4>
        <ul class="comments">
          <li v-for="c in detail.comments" :key="c.id"><span class="num muted">{{ dateTime(c.at, true).slice(-8) }}</span> <b>{{ c.name }}</b>：{{ c.text }}</li>
          <li v-if="!detail.comments.length" class="muted">{{ t('common.noData') }}</li>
        </ul>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { nextTick, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh as IconRefresh, VideoPlay as IconVideoPlay } from '@element-plus/icons-vue';
import { api } from '../../core/api';
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime, money, number } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';
import StatCard from '../../components/StatCard.vue';

const list = useList('live/sessions', { status: 'live', q: '' });
const drawer = ref(false);
const detail = ref(null);
function duration(row) {
  const ms = (row.endedAt || Date.now()) - row.startedAt;
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
async function openDetail(row) {
  detail.value = await api.get('live/sessions/' + row.id);
  drawer.value = true;
}
async function stop(row) {
  const { value } = await ElMessageBox.prompt(t('live.stopNote'), t('live.stopConfirm'), { type: 'warning', inputPlaceholder: '' });
  await api.post(`live/sessions/${row.id}/stop`, { note: value || '' });
  ElMessage.success(t('live.stopped'));
  list.load();
  if (detail.value?.session.id === row.id) openDetail(row);
}

// ---- watch: pull the host's tracks through our API proxy (the console never publishes)
const watching = ref(false);
const watchNote = ref('');
const video = ref(null);
let pc = null;
let sid = '';
async function watch() {
  stopWatch();
  watching.value = true;
  watchNote.value = t('live.watchWaiting');
  const res = await api.post(`live/sessions/${detail.value.session.id}/watch`);
  if (!res.configured) {
    watchNote.value = t('live.watchNotConfigured');
    return;
  }
  sid = res.sessionId;
  pc = new RTCPeerConnection({ iceServers: res.iceServers || [], bundlePolicy: 'max-bundle' });
  const stream = new MediaStream();
  pc.ontrack = e => {
    stream.addTrack(e.track);
    watchNote.value = '';
    nextTick(() => {
      if (video.value) {
        video.value.srcObject = stream;
        video.value.play().catch(() => {});
      }
    });
  };
  if (!res.tracks.length) return;
  const pulled = await api.post(`live/rtc/${encodeURIComponent(sid)}/tracks`, {
    tracks: res.tracks.map(tr => ({ location: 'remote', sessionId: tr.sessionId, trackName: tr.trackName })),
  });
  if (pulled.requiresImmediateRenegotiation && pulled.sessionDescription) {
    await pc.setRemoteDescription(pulled.sessionDescription);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await api.put(`live/rtc/${encodeURIComponent(sid)}/renegotiate`, { sessionDescription: { type: 'answer', sdp: pc.localDescription.sdp } });
  }
}
function stopWatch() {
  watching.value = false;
  try {
    pc?.close();
  } catch (_) {}
  pc = null;
  if (sid) api.del(`live/rtc/${encodeURIComponent(sid)}`, undefined, { quiet: true }).catch(() => {});
  sid = '';
}
</script>

<style scoped>
.detail .head { display: flex; align-items: center; gap: 8px; }
.detail .spacer { flex: 1; }
.detail h3 { margin: 12px 0; }
.detail h4 { margin: 16px 0 8px; }
.player video { width: 100%; max-height: 420px; background: #111; border-radius: 8px; }
.player .note { margin: 6px 0 12px; }
.comments { list-style: none; padding: 0; margin: 0; max-height: 280px; overflow: auto; font-size: 13px; line-height: 1.8; }
</style>
