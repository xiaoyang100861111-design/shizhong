<template>
  <div class="page">
    <div class="page-head"><h1>{{ t('desk.money') }}</h1></div>
    <div class="panel">
      <div class="filters">
        <el-input v-model="list.filters.q" :placeholder="t('desk.search')" clearable @keyup.enter="list.search" @clear="list.search" />
        <el-select v-model="list.filters.kind" clearable :placeholder="t('desk.packets.kind')" @change="list.search">
          <el-option value="envelope" :label="t('desk.packets.envelope')" /><el-option value="transfer" :label="t('desk.packets.transfer')" />
        </el-select>
        <el-select v-model="list.filters.status" clearable :placeholder="t('common.status')" @change="list.search">
          <el-option v-for="s in ['pending', 'received', 'refunded']" :key="s" :value="s" :label="t('desk.money.' + s)" />
        </el-select>
        <el-date-picker v-model="list.filters.range" type="daterange" :start-placeholder="t('common.from')" :end-placeholder="t('common.to')" @change="list.search" />
        <el-button type="primary" @click="list.search">{{ t('common.search') }}</el-button>
        <el-button @click="list.reset">{{ t('common.reset') }}</el-button>
      </div>
      <el-table v-loading="list.loading.value" :data="list.items.value" stripe>
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="claims">
              <b>{{ t('desk.packets.claims') }}</b>
              <p v-if="!row.claims.length" class="muted">—</p>
              <div v-for="c in row.claims" :key="c.userId" class="claim">
                <router-link :to="'/users/' + c.userId">{{ c.name }}</router-link>
                <span class="num">{{ money(c.amount) }}</span>
                <small class="muted num">{{ dateTime(c.at, true) }}</small>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('desk.packets.kind')" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="row.kind === 'envelope' ? 'danger' : 'primary'">{{ t('desk.packets.' + row.kind) }}</el-tag>
            <small v-if="row.count > 1" class="muted"> {{ t('desk.packets.' + row.mode) }}</small>
          </template>
        </el-table-column>
        <el-table-column :label="t('desk.packets.sender')" min-width="150">
          <template #default="{ row }"><UserCell :id="row.sender.id" :name="row.sender.name" :avatar="row.sender.avatar" :display-id="row.sender.displayId" /></template>
        </el-table-column>
        <el-table-column :label="t('desk.packets.recipient')" min-width="150">
          <template #default="{ row }">
            <UserCell v-if="row.recipient" :id="row.recipient.id" :name="row.recipient.name" :display-id="row.recipient.displayId" />
            <span v-else-if="row.group">👥 {{ row.group.name }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="t('desk.packets.amount')" width="110" align="right"><template #default="{ row }"><b class="num">{{ money(row.amount) }}</b></template></el-table-column>
        <el-table-column :label="t('desk.packets.count')" width="80" align="right"><template #default="{ row }"><span class="num">{{ row.claimCount }} / {{ row.count }}</span></template></el-table-column>
        <el-table-column :label="t('desk.packets.claimed')" width="110" align="right"><template #default="{ row }"><span class="num">{{ money(row.claimed) }}</span></template></el-table-column>
        <el-table-column :label="t('desk.packets.refunded')" width="110" align="right"><template #default="{ row }"><span class="num">{{ row.refunded ? money(row.refunded) : '—' }}</span></template></el-table-column>
        <el-table-column :label="t('common.status')" width="90">
          <template #default="{ row }"><el-tag size="small" :type="{ pending: 'warning', received: 'success' }[row.status] || 'info'">{{ t('desk.money.' + row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('desk.packets.note')" min-width="120" prop="note" />
        <el-table-column :label="t('common.createdAt')" width="150"><template #default="{ row }"><span class="num">{{ dateTime(row.createdAt) }}</span></template></el-table-column>
        <el-table-column :label="t('desk.packets.expires')" width="150"><template #default="{ row }"><span class="num muted">{{ dateTime(row.expiresAt) }}</span></template></el-table-column>
      </el-table>
      <Pager :list="list" />
    </div>
  </div>
</template>

<script setup>
import { t } from '../../core/i18n';
import { useList } from '../../core/list';
import { dateTime, money } from '../../core/format';
import Pager from '../../components/Pager.vue';
import UserCell from '../../components/UserCell.vue';

const list = useList('support/packets', { q: '', kind: '', status: '', range: [] });
</script>

<style scoped>
.claims { padding: 4px 48px; }
.claim { display: flex; gap: 16px; align-items: center; padding: 2px 0; }
</style>
