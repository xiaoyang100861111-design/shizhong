<template>
  <div class="table-foot">
    <el-pagination v-model:current-page="list.page.value" v-model:page-size="list.pageSize.value" :total="list.total.value"
      :page-sizes="[10, 20, 50, 100]" layout="total, sizes, prev, pager, next, jumper" background small
      @current-change="list.load" @size-change="list.search" />
  </div>
</template>

<script setup>
defineProps({ list: { type: Object, required: true } });
</script>
