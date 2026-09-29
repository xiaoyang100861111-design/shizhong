<template>
  <div ref="el" class="chart" :style="{ height: height + 'px' }" />
</template>

<script setup>
// series: [{ name, points: [{ day, value }], unit?, type?: 'line'|'bar' }]
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { LineChart, BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

const props = defineProps({ series: { type: Array, default: () => [] }, height: { type: Number, default: 260 } });
const el = ref();
let chart = null;
const palette = ['#c8323d', '#2f6fdb', '#1a8f4d', '#d98a00', '#7b4bd6', '#0f8ea3'];

function draw() {
  if (!chart) return;
  const dark = document.documentElement.classList.contains('dark');
  const days = props.series[0]?.points?.map(p => p.day.slice(5)) || [];
  chart.setOption(
    {
      color: palette,
      grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: dark ? '#ccc' : '#555' } },
      xAxis: { type: 'category', data: days, boundaryGap: props.series.some(s => s.type === 'bar'), axisLabel: { color: dark ? '#aaa' : '#666' } },
      yAxis: { type: 'value', axisLabel: { color: dark ? '#aaa' : '#666' }, splitLine: { lineStyle: { color: dark ? '#333' : '#eee' } } },
      series: props.series.map(s => ({
        name: s.name,
        type: s.type || 'line',
        smooth: true,
        showSymbol: false,
        areaStyle: s.type === 'bar' ? undefined : { opacity: 0.08 },
        data: s.points.map(p => Number(p.value)),
      })),
    },
    true
  );
}

let ro;
onMounted(() => {
  chart = echarts.init(el.value);
  draw();
  ro = new ResizeObserver(() => chart?.resize());
  ro.observe(el.value);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  chart?.dispose();
});
watch(() => props.series, draw, { deep: true });
</script>

<style scoped>
.chart { width: 100%; }
</style>
