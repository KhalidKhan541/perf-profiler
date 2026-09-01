/**
 * metrics.js - Performance metrics collection module
 * Collects Navigation Timing, Resource Timing, Core Web Vitals, and DOM stats.
 * Runs in content script context.
 */
(function () {
  'use strict';

  if (window.__perfProfilerMetrics) return;
  window.__perfProfilerMetrics = true;

  const MetricsCollector = {
    _lcp: null,
    _cls: 0,
    _clsEntries: [],
    _inp: null,
    _longTasks: [],
    _layoutShifts: [],
    _customMarks: [],
    _resourceTimings: [],
    _performanceObserver: null,

    init() {
      this._observeLCP();
      this._observeCLS();
      this._observeINP();
      this._observeLongTasks();
      this._observeResources();
      this._observeNavigation();
    },

    _observeLCP() {
      try {
        this._performanceObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          if (lastEntry) {
            this._lcp = {
              value: lastEntry.startTime,
              element: lastEntry.element ? lastEntry.element.tagName : null,
              url: lastEntry.url || null,
              size: lastEntry.size || 0,
              renderTime: lastEntry.renderTime,
              loadTime: lastEntry.loadTime,
            };
          }
        });
        this._performanceObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch (e) { /* not supported */ }
    },

    _observeCLS() {
      try {
        const clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) {
              this._cls += entry.value;
              this._clsEntries.push({
                value: entry.value,
                startTime: entry.startTime,
                sources: entry.sources
                  ? entry.sources.map((s) => ({
                      node: s.node ? s.node.nodeName : null,
                      previousRect: s.previousRect ? this._rectToObj(s.previousRect) : null,
                      currentRect: s.currentRect ? this._rectToObj(s.currentRect) : null,
                    }))
                  : [],
              });
            }
          }
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });
      } catch (e) { /* not supported */ }
    },

    _observeINP() {
      try {
        const interactionEvents = [];
        const inpObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            interactionEvents.push({
              interactionId: entry.interactionId,
              latency: entry.duration,
              startTime: entry.startTime,
              processingStart: entry.processingStart,
              processingEnd: entry.processingEnd,
              presentationTime: entry.presentationTime || 0,
            });
          }
          if (interactionEvents.length > 0) {
            const maxLatency = Math.max(...interactionEvents.map((e) => e.latency));
            const worstEvent = interactionEvents.find((e) => e.latency === maxLatency);
            this._inp = {
              value: maxLatency,
              interactionType: worstEvent ? 'unknown' : 'unknown',
              events: interactionEvents,
            };
          }
        });
        inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 40 });
      } catch (e) { /* not supported */ }
    },

    _observeLongTasks() {
      try {
        const ltObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this._longTasks.push({
              duration: entry.duration,
              startTime: entry.startTime,
              attribution: entry.attribution
                ? entry.attribution.map((a) => ({
                    name: a.name,
                    entryType: a.entryType,
                    startTime: a.startTime,
                    duration: a.duration,
                  }))
                : [],
            });
          }
        });
        ltObserver.observe({ type: 'longtask', buffered: true });
      } catch (e) { /* not supported */ }
    },

    _observeResources() {
      try {
        const resObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this._resourceTimings.push(this._formatResourceEntry(entry));
          }
        });
        resObserver.observe({ type: 'resource', buffered: true });
      } catch (e) { /* not supported */ }
    },

    _observeNavigation() {
      try {
        const navObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this._navEntry = this._formatNavEntry(entry);
          }
        });
        navObserver.observe({ type: 'navigation', buffered: true });
      } catch (e) { /* not supported */ }
    },

    _rectToObj(rect) {
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    },

    _formatResourceEntry(entry) {
      const url = new URL(entry.name);
      const ext = url.pathname.split('.').pop().toLowerCase();
      let type = 'other';
      if (['js', 'mjs'].includes(ext) || entry.initiatorType === 'script') type = 'js';
      else if (['css'].includes(ext) || entry.initiatorType === 'css' || entry.initiatorType === 'link') type = 'css';
      else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'ico'].includes(ext) || entry.initiatorType === 'img') type = 'image';
      else if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) type = 'font';

      return {
        name: entry.name,
        shortName: this._shortenUrl(entry.name),
        type,
        initiatorType: entry.initiatorType,
        startTime: entry.startTime,
        duration: entry.duration,
        dns: entry.domainLookupEnd - entry.domainLookupStart,
        tcp: entry.connectEnd - entry.connectStart,
        ssl: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
        ttfb: entry.responseStart - entry.requestStart,
        download: entry.responseEnd - entry.responseStart,
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
        decodedBodySize: entry.decodedBodySize || 0,
        blocked: entry.responseStart - entry.startTime - (entry.connectEnd - entry.connectStart) - (entry.domainLookupEnd - entry.domainLookupStart),
        renderBlockingStatus: entry.renderBlockingStatus || 'unknown',
        workerStart: entry.workerStart || 0,
        serverTiming: entry.serverTiming || [],
      };
    },

    _formatNavEntry(entry) {
      return {
        name: entry.name,
        type: entry.type,
        redirectCount: entry.redirectCount,
        redirectTime: entry.redirectEnd - entry.redirectStart,
        dns: entry.domainLookupEnd - entry.domainLookupStart,
        tcp: entry.connectEnd - entry.connectStart,
        ssl: entry.secureConnectionStart > 0 ? entry.connectEnd - entry.secureConnectionStart : 0,
        ttfb: entry.responseStart - entry.requestStart,
        download: entry.responseEnd - entry.responseStart,
        domInteractive: entry.domInteractive,
        domContentLoaded: entry.domContentLoadedEventEnd,
        domComplete: entry.domComplete,
        loadEvent: entry.loadEventEnd,
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
        decodedBodySize: entry.decodedBodySize || 0,
        type: entry.type,
        workerStart: entry.workerStart || 0,
      };
    },

    _shortenUrl(url, maxLen) {
      maxLen = maxLen || 50;
      try {
        const u = new URL(url);
        let path = u.pathname;
        if (path.length > 30) path = '...' + path.slice(-27);
        return u.hostname + path;
      } catch (e) {
        return url.length > maxLen ? url.slice(0, maxLen) + '...' : url;
      }
    },

    getNavigationTiming() {
      if (this._navEntry) return this._navEntry;
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) return this._formatNavEntry(nav);
      return null;
    },

    getResourceTimings() {
      if (this._resourceTimings.length > 0) return this._resourceTimings;
      return performance.getEntriesByType('resource').map((e) => this._formatResourceEntry(e));
    },

    getLCP() {
      return this._lcp;
    },

    getCLS() {
      return { value: this._cls, entries: this._clsEntries };
    },

    getINP() {
      return this._inp;
    },

    getLongTasks() {
      return this._longTasks;
    },

    getFCP() {
      const entries = performance.getEntriesByName('first-contentful-paint');
      if (entries.length > 0) return entries[0].startTime;
      const paintEntries = performance.getEntriesByType('paint');
      const fcp = paintEntries.find((e) => e.name === 'first-contentful-paint');
      return fcp ? fcp.startTime : null;
    },

    getSpeedIndex() {
      const paintEntries = performance.getEntriesByType('paint');
      const fp = paintEntries.find((e) => e.name === 'first-paint');
      const fcp = paintEntries.find((e) => e.name === 'first-contentful-paint');
      if (fp && fcp) return fcp.startTime + (fcp.startTime - fp.startTime) * 0.5;
      if (fcp) return fcp.startTime * 1.2;
      return null;
    },

    getTTI() {
      const nav = this.getNavigationTiming();
      if (!nav) return null;
      const domInteractive = nav.domInteractive;
      const longTaskEnd = this._longTasks.length > 0
        ? Math.max(...this._longTasks.map((t) => t.startTime + t.duration))
        : 0;
      return Math.max(domInteractive, longTaskEnd);
    },

    getTBT() {
      let totalBlockingTime = 0;
      for (const task of this._longTasks) {
        if (task.duration > 50) {
          totalBlockingTime += task.duration - 50;
        }
      }
      if (totalBlockingTime === 0 && this._inp) {
        totalBlockingTime = this._inp.value > 200 ? this._inp.value * 0.3 : 0;
      }
      return totalBlockingTime;
    },

    getDOMStats() {
      const allElements = document.querySelectorAll('*');
      const elementCount = allElements.length;
      let maxDepth = 0;
      let depthDistribution = {};
      const classSet = new Set();
      const idSet = new Set();
      const tagCounts = {};

      for (const el of allElements) {
        let depth = 0;
        let node = el;
        while (node.parentElement) {
          depth++;
          node = node.parentElement;
        }
        if (depth > maxDepth) maxDepth = depth;
        depthDistribution[depth] = (depthDistribution[depth] || 0) + 1;

        const tag = el.tagName.toLowerCase();
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;

        if (el.className && typeof el.className === 'string') {
          el.className.split(/\s+/).filter(Boolean).forEach((c) => classSet.add(c));
        }
        if (el.id) idSet.add(el.id);
      }

      return {
        elementCount,
        maxDepth,
        uniqueClasses: classSet.size,
        idsUsed: idSet.size,
        depthDistribution,
        tagCounts,
        topTags: Object.entries(tagCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      };
    },

    getMemoryUsage() {
      if (performance.memory) {
        return {
          usedJSHeap: performance.memory.usedJSHeapSize,
          totalJSHeap: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        };
      }
      return null;
    },

    getThirdPartyScripts() {
      const resources = this.getResourceTimings();
      const currentHost = location.hostname;
      const thirdParty = {};

      for (const res of resources) {
        if (res.type !== 'js') continue;
        try {
          const url = new URL(res.name);
          if (url.hostname !== currentHost) {
            if (!thirdParty[url.hostname]) {
              thirdParty[url.hostname] = { count: 0, totalSize: 0, resources: [] };
            }
            thirdParty[url.hostname].count++;
            thirdParty[url.hostname].totalSize += res.transferSize;
            thirdParty[url.hostname].resources.push(res.shortName);
          }
        } catch (e) { /* skip invalid URLs */ }
      }

      return Object.entries(thirdParty)
        .map(([domain, data]) => ({ domain, ...data }))
        .sort((a, b) => b.totalSize - a.totalSize);
    },

    getRenderBlockingResources() {
      const resources = this.getResourceTimings();
      return resources.filter(
        (r) => r.renderBlockingStatus === 'blocking' || (r.type === 'css' && r.startTime < 1000)
      );
    },

    getTBTFromMainThread() {
      let blockingTime = 0;
      const longTasks = this.getLongTasks();
      for (const task of longTasks) {
        if (task.duration > 50) {
          blockingTime += task.duration - 50;
        }
      }
      return blockingTime;
    },

    collectAll() {
      return {
        timestamp: Date.now(),
        url: location.href,
        hostname: location.hostname,
        navigation: this.getNavigationTiming(),
        resources: this.getResourceTimings(),
        lcp: this.getLCP(),
        cls: this.getCLS(),
        inp: this.getINP(),
        fcp: this.getFCP(),
        speedIndex: this.getSpeedIndex(),
        tti: this.getTTI(),
        tbt: this.getTBT(),
        longTasks: this.getLongTasks(),
        domStats: this.getDOMStats(),
        memory: this.getMemoryUsage(),
        thirdParty: this.getThirdPartyScripts(),
        renderBlocking: this.getRenderBlockingResources(),
      };
    },

    addMark(name) {
      performance.mark(name);
      this._customMarks.push({ name, time: performance.now() });
    },

    getCustomMarks() {
      return this._customMarks;
    },
  };

  MetricsCollector.init();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'collectMetrics') {
      const data = MetricsCollector.collectAll();
      sendResponse({ success: true, data });
      return true;
    }
    if (msg.action === 'addMark') {
      MetricsCollector.addMark(msg.name);
      sendResponse({ success: true });
      return true;
    }
    if (msg.action === 'getMetrics') {
      sendResponse({
        success: true,
        data: {
          lcp: MetricsCollector.getLCP(),
          cls: MetricsCollector.getCLS(),
          inp: MetricsCollector.getINP(),
          fcp: MetricsCollector.getFCP(),
          speedIndex: MetricsCollector.getSpeedIndex(),
          tti: MetricsCollector.getTTI(),
          tbt: MetricsCollector.getTBT(),
          longTasks: MetricsCollector.getLongTasks(),
          domStats: MetricsCollector.getDOMStats(),
          memory: MetricsCollector.getMemoryUsage(),
          resources: MetricsCollector.getResourceTimings(),
          navigation: MetricsCollector.getNavigationTiming(),
          thirdParty: MetricsCollector.getThirdPartyScripts(),
          renderBlocking: MetricsCollector.getRenderBlockingResources(),
        },
      });
      return true;
    }
  });
})();
