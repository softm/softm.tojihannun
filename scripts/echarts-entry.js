import * as echarts from 'echarts/core';
import {BarChart, CustomChart, LineChart, ScatterChart} from 'echarts/charts';
import {AriaComponent, AxisPointerComponent, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent} from 'echarts/components';
import {SVGRenderer} from 'echarts/renderers';

echarts.use([
  LineChart,
  ScatterChart,
  CustomChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  AxisPointerComponent,
  LegendComponent,
  AriaComponent,
  SVGRenderer
]);

globalThis.TojiECharts = echarts;
