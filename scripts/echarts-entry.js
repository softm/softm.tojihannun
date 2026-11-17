import * as echarts from 'echarts/core';
import {CustomChart, LineChart, ScatterChart} from 'echarts/charts';
import {AriaComponent, AxisPointerComponent, DataZoomComponent, GridComponent, TooltipComponent} from 'echarts/components';
import {SVGRenderer} from 'echarts/renderers';

echarts.use([
  LineChart,
  ScatterChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
  AxisPointerComponent,
  AriaComponent,
  SVGRenderer
]);

globalThis.TojiECharts = echarts;
