import { Component, ElementRef, input, effect, viewChild, ViewEncapsulation, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

declare const d3: any;

@Component({
  selector: 'app-d3-bar-chart',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="relative w-full h-full flex flex-col group overflow-hidden">
      <div class="flex justify-end items-center gap-4 text-[10px] md:text-xs mb-1 px-4 shrink-0 opacity-80 hover:opacity-100 transition-opacity">
        <div class="flex items-center gap-1.5">
          <span class="w-2.5 h-2.5 rounded-sm shadow-sm" [style.background-color]="barColor()"></span>
          <span class="font-bold text-gray-600">{{ barLabel() }}</span>
        </div>
        @if (showLineLegend) {
          <div class="flex items-center gap-1.5">
            <div class="w-4 h-[2px] relative flex justify-center items-center" [style.background-color]="lineColor()">
               <div class="w-1.5 h-1.5 rotate-45 border border-white" [style.background-color]="lineColor()"></div>
            </div>
            <span class="font-bold text-gray-600">{{ lineLabel() }}</span>
          </div>
        }
      </div>
      <div #chartContainer class="w-full flex-1 min-h-0 relative z-10"></div>
      <div #tooltip class="absolute hidden bg-slate-800/95 backdrop-blur text-white text-xs rounded shadow-2xl border border-slate-600 whitespace-nowrap z-[50] pointer-events-none transition-opacity duration-75 p-3 select-none"></div>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; height: 100%; }
    .axis text { font-size: 10px; font-family: 'Inter', sans-serif; fill: #64748B; font-weight: 600; }
    .axis path, .axis line { stroke: #E2E8F0; }
    .grid line { stroke: #F1F5F9; stroke-dasharray: 4; }
    .bar { cursor: crosshair; rx: 3px; ry: 3px; shape-rendering: geometricPrecision; }
    .bar:hover { filter: brightness(1.1); stroke: rgba(255,255,255,0.2); stroke-width: 1px; }
  `],
  encapsulation: ViewEncapsulation.None
})
export class D3BarChartComponent implements OnDestroy {
  data = input.required<any[]>();
  xKey = input('day');
  barDataKey = input.required<string>();
  lineDataKey = input<string | undefined>(undefined);
  barLabel = input('Real');
  lineLabel = input('Plan');
  barColor = input('#F40000');
  lineColor = input('#1E1E1E');
  lowerIsBetter = input(false);
  valueFormat = input<'number' | 'time'>('number');
  performanceMode = input<'high' | 'eco'>('high');
  autoScroll = input(false);
  windowSize = input(12);
  container = viewChild<ElementRef>('chartContainer');
  tooltipRef = viewChild<ElementRef>('tooltip');
  private resizeObserver: ResizeObserver | null = null;
  private scrollInterval: any;
  private currentOffset = 0;

  get showLineLegend(): boolean {
    return !!this.lineDataKey() && this.data().length > 0 && (this.lineDataKey()! in this.data()[0]);
  }

  constructor() {
    effect(() => {
      const data = this.data();
      const containerRef = this.container();
      if (containerRef && containerRef.nativeElement && data) {
        requestAnimationFrame(() => this.render());
        if (!this.resizeObserver) {
          this.resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(() => this.render());
          });
          this.resizeObserver.observe(containerRef.nativeElement);
        }
      }
    });
    effect(() => {
      if (this.autoScroll()) this.startScrolling();
      else this.stopScrolling();
    });
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    this.stopScrolling();
  }

  private startScrolling() {
    this.stopScrolling();
    this.scrollInterval = setInterval(() => {
      const data = this.data();
      const winSize = this.windowSize();
      if (!data || data.length <= winSize) return;
      this.currentOffset++;
      if (this.currentOffset > data.length - winSize) this.currentOffset = 0;
      this.render();
    }, 4000);
  }

  private stopScrolling() {
    if (this.scrollInterval) clearInterval(this.scrollInterval);
  }

  private formatValue(val: number): string {
    if (this.valueFormat() === 'time') {
      const hrs = Math.floor(val / 60);
      const mins = Math.round(val % 60);
      return `${hrs}:${mins.toString().padStart(2, '0')}`;
    }
    return d3.format(",")(val);
  }

  private escapeHtml(s: string): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private sanitizeCssColor(color: string): string {
    const c = String(color ?? '').trim();
    if (/^#[0-9A-Fa-f]{3,8}$/.test(c)) return c;
    if (/^[a-zA-Z]+$/.test(c)) return c;
    return '#000000';
  }

  render() {
    if (!this.container()?.nativeElement || !this.data()) return;
    const fullData = this.data();
    const winSize = this.windowSize();
    let renderData = fullData;
    if (fullData.length > winSize) {
      const end = Math.min(this.currentOffset + winSize, fullData.length);
      renderData = fullData.slice(this.currentOffset, end);
    }
    this.drawChart(this.container()!.nativeElement, renderData);
  }

  drawChart(element: HTMLElement, data: any[]) {
    if (!data || data.length === 0) return;
    if (element.clientWidth === 0 || element.clientHeight === 0) return;
    const isEcoMode = this.performanceMode() === 'eco';
    const xKey = this.xKey();
    const barKey = this.barDataKey();
    const lineKey = this.lineDataKey();
    const barColor = this.barColor();
    const lineColor = this.lineColor();
    const tooltip = d3.select(this.tooltipRef()?.nativeElement);
    const hasLine = !!lineKey && (lineKey in data[0]);
    const margin = { top: 25, right: 30, bottom: 25, left: 35 };
    const width = element.clientWidth - margin.left - margin.right;
    const height = element.clientHeight - margin.top - margin.bottom;
    let svg = d3.select(element).select('svg');
    let g: any;
    if (svg.empty()) {
      svg = d3.select(element).append('svg').attr('width', '100%').attr('height', '100%');
      g = svg.append('g').attr('class', 'chart-content').attr('transform', `translate(${margin.left},${margin.top})`);
      g.append('g').attr('class', 'grid');
      g.append('g').attr('class', 'x-axis');
      g.append('g').attr('class', 'y-axis');
      g.append('g').attr('class', 'bars-group');
      g.append('g').attr('class', 'labels-group');
      g.append('g').attr('class', 'line-group');
      g.append('g').attr('class', 'line-labels-group');
    } else {
      g = svg.select('.chart-content');
      g.attr('transform', `translate(${margin.left},${margin.top})`);
    }
    svg.attr('viewBox', `0 0 ${element.clientWidth} ${element.clientHeight}`);
    const x = d3.scaleBand().domain(data.map((d: any) => d[xKey])).range([0, width]).padding(0.35);
    const maxVal = d3.max(data, (d: any) => Math.max(d[barKey] || 0, hasLine ? (d[lineKey!] || 0) : 0)) || 100;
    const y = d3.scaleLinear().domain([0, maxVal * 1.2]).range([height, 0]);
    const transitionDuration = isEcoMode ? 0 : 750;
    const t = d3.transition().duration(transitionDuration).ease(d3.easeQuadOut);
    g.select('.grid').transition(t).call(d3.axisRight(y).tickSize(width).tickFormat('').ticks(5)).style('stroke-opacity', 0.1).call((s: any) => s.select('.domain').remove());
    g.select('.x-axis').attr('transform', `translate(0,${height})`).transition(t).call(d3.axisBottom(x).tickSize(0)).selectAll('text').style('text-anchor', 'middle').attr('dy', '12px').style('fill', '#64748B');
    g.select('.x-axis').select('.domain').attr('stroke', '#CBD5E1');
    g.select('.y-axis').transition(t).call(d3.axisLeft(y).ticks(5).tickFormat((d: number) => this.formatValue(d)).tickSize(0)).select('.domain').remove();
    const bars = g.select('.bars-group').selectAll('.bar').data(data, (d: any) => d[xKey]);
    bars.join(
      (enter: any) => enter.append('rect').attr('class', 'bar').attr('fill', barColor).attr('x', (d: any) => x(d[xKey])).attr('width', x.bandwidth()).attr('y', height).attr('height', 0).attr('opacity', 0)
        .call((e: any) => e.transition(t).attr('y', (d: any) => y(d[barKey] || 0)).attr('height', (d: any) => height - y(d[barKey] || 0)).attr('opacity', 1)),
      (update: any) => update.call((u: any) => u.transition(t).attr('x', (d: any) => x(d[xKey])).attr('width', x.bandwidth()).attr('y', (d: any) => y(d[barKey] || 0)).attr('height', (d: any) => height - y(d[barKey] || 0)).attr('fill', barColor)),
      (exit: any) => exit.call((e: any) => e.transition(t).attr('y', height).attr('height', 0).attr('opacity', 0).remove())
    ).on('mouseover', () => tooltip.classed('hidden', false)).on('mousemove', (event: any, d: any) => this.updateTooltip(event, d, element, tooltip, barColor, hasLine, lineKey, barKey)).on('mouseout', () => tooltip.classed('hidden', true));
    const labels = g.select('.labels-group').selectAll('.bar-label').data(data, (d: any) => d[xKey]);
    labels.join(
      (enter: any) => enter.append('text').attr('class', 'bar-label').attr('text-anchor', 'middle').attr('fill', '#334155').attr('font-size', '9px').attr('font-weight', '700').style('pointer-events', 'none')
        .attr('x', (d: any) => x(d[xKey])! + x.bandwidth() / 2).attr('y', height).attr('opacity', 0).text((d: any) => this.formatValue(d[barKey] || 0))
        .call((e: any) => e.transition(t).attr('y', (d: any) => y(d[barKey] || 0) - 6).attr('opacity', 1)),
      (update: any) => update.text((d: any) => this.formatValue(d[barKey] || 0)).call((u: any) => u.transition(t).attr('x', (d: any) => x(d[xKey])! + x.bandwidth() / 2).attr('y', (d: any) => y(d[barKey] || 0) - 6).attr('opacity', 1)),
      (exit: any) => exit.transition(t).attr('opacity', 0).remove()
    );
    const lineGroup = g.select('.line-group');
    lineGroup.selectAll('*').remove();
    if (hasLine) {
      const lineFn = d3.line().curve(d3.curveMonotoneX).x((d: any) => x(d[xKey])! + x.bandwidth() / 2).y((d: any) => y(d[lineKey!] || 0));
      lineGroup.append('path').datum(data).attr('fill', 'none').attr('stroke', lineColor).attr('stroke-width', 2.5).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round').attr('opacity', 0).attr('d', lineFn).transition(t).attr('opacity', 1);
      lineGroup.selectAll('.point').data(data, (d: any) => d[xKey]).join('circle').attr('class', 'point').attr('r', 4.5).attr('fill', '#FFFFFF').attr('stroke', lineColor).attr('stroke-width', 2.5)
        .attr('cx', (d: any) => x(d[xKey])! + x.bandwidth() / 2).attr('cy', (d: any) => y(d[lineKey!] || 0)).attr('opacity', 0).transition(t).attr('opacity', 1);
    }
  }

  updateTooltip(event: any, d: any, element: HTMLElement, tooltip: any, color: string, hasLine: boolean, lineKey?: string, barKey?: string) {
    const [mouseX, mouseY] = d3.pointer(event, element);
    const containerWidth = element.clientWidth;
    const containerHeight = element.clientHeight;
    const offsetTop = element.offsetTop;
    const offsetLeft = element.offsetLeft;
    const safeColor = this.sanitizeCssColor(color);
    const safeX = this.escapeHtml(String(d[this.xKey()] ?? ''));
    const safeBarLabel = this.escapeHtml(String(this.barLabel() ?? ''));
    const barVal = this.escapeHtml(this.formatValue(d[barKey!] || 0));
    let html = `<div class="flex flex-col gap-1.5"><div class="font-bold border-b border-gray-600 pb-1.5 text-slate-300 text-[10px] uppercase tracking-wider leading-none">${safeX}</div><div class="flex justify-between items-center gap-6"><div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full shadow-sm" style="background-color:${safeColor}"></span><span class="font-semibold text-gray-300 text-[11px]">${safeBarLabel}</span></div><span class="font-bold text-white text-xs font-mono">${barVal}</span></div>`;
    if (hasLine && lineKey) {
      const lineVal = this.escapeHtml(this.formatValue(d[lineKey] || 0));
      const diff = (d[barKey!] || 0) - (d[lineKey] || 0);
      let isGood = diff >= 0;
      if (this.lowerIsBetter()) isGood = diff <= 0;
      const diffColor = isGood ? 'text-emerald-400' : 'text-rose-400';
      const diffSymbol = diff > 0 ? '+' : '';
      const rawDiffVal = this.valueFormat() === 'time' ? (diffSymbol + this.formatValue(Math.abs(diff))) : (diffSymbol + d3.format(",")(diff));
      const diffVal = this.escapeHtml(rawDiffVal);
      const safeLineColor = this.sanitizeCssColor(this.lineColor());
      const safeLineLabel = this.escapeHtml(String(this.lineLabel() ?? ''));
      const suffix = this.valueFormat() === 'time' ? ' min' : '';
      html += `<div class="flex justify-between items-center gap-6"><div class="flex items-center gap-1.5"><div class="w-2 h-0.5" style="background-color: ${safeLineColor}"></div><span class="font-semibold text-gray-400 text-[11px]">${safeLineLabel}</span></div><span class="font-bold text-gray-300 text-xs font-mono">${lineVal}</span></div><div class="mt-1 pt-1.5 border-t border-slate-700 flex justify-between items-center text-[10px]"><span class="text-slate-500 font-semibold uppercase tracking-tight">Variacion</span><div class="bg-slate-900/50 px-1.5 py-0.5 rounded border border-slate-700/50"><span class="font-black ${diffColor} font-mono">${diffVal}${suffix}</span></div></div>`;
    }
    html += `</div>`;
    tooltip.html(html);
    const tooltipNode = tooltip.node();
    if (tooltipNode) {
      const tipRect = tooltipNode.getBoundingClientRect();
      let left = mouseX + offsetLeft + 16;
      let top = mouseY + offsetTop - (tipRect.height / 2);
      if (left + tipRect.width > (containerWidth + offsetLeft)) left = mouseX + offsetLeft - tipRect.width - 16;
      if (top + tipRect.height > (containerHeight + offsetTop)) top = (containerHeight + offsetTop) - tipRect.height - 4;
      if (top < offsetTop) top = offsetTop + 4;
      if (left < 0) left = 4;
      tooltip.style('left', left + 'px').style('top', top + 'px');
    }
  }
}
