/**
 * content.js - Content script for Perf Profiler
 * Bridges content script metrics collection with the extension popup and background.
 */
(function () {
  'use strict';

  if (window.__perfProfilerContent) return;
  window.__perfProfilerContent = true;

  const CONTENT_SCRIPT_VERSION = '1.0.0';

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'ping') {
      sendResponse({ alive: true, version: CONTENT_SCRIPT_VERSION });
      return true;
    }

    if (msg.action === 'collectAllMetrics') {
      try {
        const data = window.__perfProfilerMetrics
          ? null
          : null;

        const metrics = {
          timestamp: Date.now(),
          url: location.href,
          hostname: location.hostname,
          title: document.title,
          doctype: document.doctype ? document.doctype.name : null,
          charset: document.characterSet,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
            dpr: window.devicePixelRatio,
          },
        };

        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) {
          metrics.navigation = {
            name: nav.name,
            type: nav.type,
            redirectCount: nav.redirectCount,
            redirectTime: nav.redirectEnd - nav.redirectStart,
            dns: nav.domainLookupEnd - nav.domainLookupStart,
            tcp: nav.connectEnd - nav.connectStart,
            ssl: nav.secureConnectionStart > 0 ? nav.connectEnd - nav.secureConnectionStart : 0,
            ttfb: nav.responseStart - nav.requestStart,
            download: nav.responseEnd - nav.responseStart,
            domInteractive: nav.domInteractive,
            domContentLoaded: nav.domContentLoadedEventEnd,
            domComplete: nav.domComplete,
            loadEvent: nav.loadEventEnd,
            transferSize: nav.transferSize || 0,
            encodedBodySize: nav.encodedBodySize || 0,
            decodedBodySize: nav.decodedBodySize || 0,
          };
        }

        const paintEntries = performance.getEntriesByType('paint');
        metrics.paint = {};
        for (const pe of paintEntries) {
          metrics.paint[pe.name] = pe.startTime;
        }

        const allResources = performance.getEntriesByType('resource');
        const currentHost = location.hostname;
        metrics.resources = allResources.map((entry) => {
          const url = new URL(entry.name);
          const ext = url.pathname.split('.').pop().toLowerCase();
          let type = 'other';
          if (['js', 'mjs'].includes(ext) || entry.initiatorType === 'script') type = 'js';
          else if (['css'].includes(ext) || entry.initiatorType === 'css' || entry.initiatorType === 'link') type = 'css';
          else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'ico'].includes(ext) || entry.initiatorType === 'img') type = 'image';
          else if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext)) type = 'font';

          let shortName;
          try {
            let path = url.pathname;
            if (path.length > 30) path = '...' + path.slice(-27);
            shortName = url.hostname + path;
          } catch (e) {
            shortName = entry.name.length > 50 ? entry.name.slice(0, 50) + '...' : entry.name;
          }

          return {
            name: entry.name,
            shortName,
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
            blocked: Math.max(0, entry.responseStart - entry.startTime - (entry.connectEnd - entry.connectStart) - (entry.domainLookupEnd - entry.domainLookupStart)),
            renderBlockingStatus: entry.renderBlockingStatus || 'unknown',
          };
        });

        const lcpEntries = performance.getEntriesByType('largest-contentful-paint');
        if (lcpEntries.length > 0) {
          const lastLcp = lcpEntries[lcpEntries.length - 1];
          metrics.lcp = {
            value: lastLcp.startTime,
            element: lastLcp.element ? lastLcp.element.tagName : null,
            url: lastLcp.url || null,
            size: lastLcp.size || 0,
            renderTime: lastLcp.renderTime,
            loadTime: lastLcp.loadTime,
          };
        }

        let clsValue = 0;
        const clsEntries = performance.getEntriesByType('layout-shift');
        for (const entry of clsEntries) {
          if (!entry.hadRecentInput) {
            clsValue += entry.value;
          }
        }
        metrics.cls = { value: clsValue, entries: clsEntries.length };

        const fcp = metrics.paint['first-contentful-paint'] || null;
        metrics.fcp = fcp;

        const fp = metrics.paint['first-paint'] || null;
        if (fcp && fp) {
          metrics.speedIndex = fcp + (fcp - fp) * 0.5;
        } else if (fcp) {
          metrics.speedIndex = fcp * 1.2;
        }

        metrics.tti = nav ? Math.max(nav.domInteractive, 0) : null;

        let totalBlockingTime = 0;
        const longTasks = performance.getEntriesByType('longtask') || [];
        metrics.longTasks = longTasks.map((t) => ({
          duration: t.duration,
          startTime: t.startTime,
        }));
        for (const task of longTasks) {
          if (task.duration > 50) {
            totalBlockingTime += task.duration - 50;
          }
        }
        metrics.tbt = totalBlockingTime;

        const allElements = document.querySelectorAll('*');
        let maxDepth = 0;
        const depthDistribution = {};
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

        metrics.domStats = {
          elementCount: allElements.length,
          maxDepth,
          uniqueClasses: classSet.size,
          idsUsed: idSet.size,
          depthDistribution,
          tagCounts,
          topTags: Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10),
        };

        if (performance.memory) {
          metrics.memory = {
            usedJSHeap: performance.memory.usedJSHeapSize,
            totalJSHeap: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          };
        }

        const thirdParty = {};
        for (const res of metrics.resources) {
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
          } catch (e) { /* skip */ }
        }
        metrics.thirdParty = Object.entries(thirdParty)
          .map(([domain, data]) => ({ domain, ...data }))
          .sort((a, b) => b.totalSize - a.totalSize);

        metrics.renderBlocking = metrics.resources.filter(
          (r) => r.renderBlockingStatus === 'blocking' || (r.type === 'css' && r.startTime < 1000)
        );

        sendResponse({ success: true, data: metrics });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return true;
    }

    if (msg.action === 'addPerformanceMark') {
      try {
        performance.mark(msg.name);
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (msg.action === 'getPerformanceMarks') {
      try {
        const marks = performance.getEntriesByType('mark');
        sendResponse({ success: true, marks: marks.map((m) => ({ name: m.name, startTime: m.startTime })) });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }
  });

  chrome.runtime.sendMessage({ action: 'contentScriptReady', tabId: null });
})();
