/**
 * analyzer.js - Performance analysis module
 * Calculates scores, generates recommendations, thresholds, trend analysis.
 * Runs in background/popup context.
 */
(function () {
  'use strict';

  const Analyzer = {
    THRESHOLDS: {
      lcp: { good: 2500, poor: 4000 },
      inp: { good: 200, poor: 500 },
      cls: { good: 0.1, poor: 0.25 },
      fcp: { good: 1800, poor: 3000 },
      tti: { good: 3800, poor: 7300 },
      tbt: { good: 200, poor: 600 },
      si: { good: 3400, poor: 5800 },
    },

    WEIGHTS: {
      lcp: 0.25,
      inp: 0.25,
      cls: 0.25,
      fcp: 0.1,
      tbt: 0.1,
      si: 0.05,
    },

    getThreshold(value, metric) {
      const t = this.THRESHOLDS[metric];
      if (!t) return 'unknown';
      if (value <= t.good) return 'good';
      if (value <= t.poor) return 'needs-improvement';
      return 'poor';
    },

    calculateScore(metrics) {
      const scores = {};

      for (const [metric, weight] of Object.entries(this.WEIGHTS)) {
        let value;
        if (metric === 'lcp') value = metrics.lcp ? metrics.lcp.value : null;
        else if (metric === 'inp') value = metrics.inp ? metrics.inp.value : null;
        else if (metric === 'cls') value = metrics.cls ? metrics.cls.value : null;
        else value = metrics[metric] || null;

        if (value === null || value === undefined) {
          scores[metric] = { value: null, score: 0, weight, threshold: 'unknown' };
          continue;
        }

        const threshold = this.getThreshold(value, metric);
        let score;
        if (threshold === 'good') {
          const t = this.THRESHOLDS[metric];
          score = 100 - (value / t.good) * 20;
        } else if (threshold === 'needs-improvement') {
          const t = this.THRESHOLDS[metric];
          const ratio = (value - t.good) / (t.poor - t.good);
          score = 80 - ratio * 40;
        } else {
          const t = this.THRESHOLDS[metric];
          const ratio = Math.min((value - t.poor) / (t.poor * 2), 1);
          score = 40 - ratio * 40;
        }

        scores[metric] = {
          value,
          score: Math.max(0, Math.min(100, Math.round(score))),
          weight,
          threshold,
        };
      }

      let totalWeight = 0;
      let weightedSum = 0;
      for (const data of Object.values(scores)) {
        if (data.value !== null) {
          weightedSum += data.score * data.weight;
          totalWeight += data.weight;
        }
      }

      const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
      const overallThreshold = overallScore >= 90 ? 'good' : overallScore >= 50 ? 'needs-improvement' : 'poor';

      return {
        overall: overallScore,
        overallThreshold,
        metrics: scores,
      };
    },

    generateRecommendations(metrics, analysis) {
      const recs = [];

      if (metrics.lcp && metrics.lcp.value) {
        const lcp = metrics.lcp.value;
        if (lcp > this.THRESHOLDS.lcp.poor) {
          recs.push({
            severity: 'critical',
            title: 'Optimize Largest Contentful Paint',
            description: `LCP is ${(lcp / 1000).toFixed(1)}s (target: <2.5s). Optimize the main image or text element, use preload hints, and reduce server response times.`,
            metric: 'lcp',
          });
        } else if (lcp > this.THRESHOLDS.lcp.good) {
          recs.push({
            severity: 'warning',
            title: 'Improve LCP timing',
            description: `LCP is ${(lcp / 1000).toFixed(1)}s. Consider preloading hero images, inlining critical CSS, or using a CDN.`,
            metric: 'lcp',
          });
        }
      }

      if (metrics.cls && metrics.cls.value !== undefined) {
        const cls = metrics.cls.value;
        if (cls > this.THRESHOLDS.cls.poor) {
          recs.push({
            severity: 'critical',
            title: 'Fix layout shifts',
            description: `CLS is ${cls.toFixed(3)} (target: <0.1). Set explicit dimensions on images/ads, avoid dynamically injected content, and use CSS containment.`,
            metric: 'cls',
          });
        } else if (cls > this.THRESHOLDS.cls.good) {
          recs.push({
            severity: 'warning',
            title: 'Reduce layout instability',
            description: `CLS is ${cls.toFixed(3)}. Reserve space for dynamic content and use aspect-ratio CSS property.`,
            metric: 'cls',
          });
        }
      }

      if (metrics.inp && metrics.inp.value) {
        const inp = metrics.inp.value;
        if (inp > this.THRESHOLDS.inp.poor) {
          recs.push({
            severity: 'critical',
            title: 'Improve interaction responsiveness',
            description: `INP is ${Math.round(inp)}ms (target: <200ms). Break up long tasks, use requestIdleCallback, and reduce main thread work.`,
            metric: 'inp',
          });
        } else if (inp > this.THRESHOLDS.inp.good) {
          recs.push({
            severity: 'warning',
            title: 'Optimize event handlers',
            description: `INP is ${Math.round(inp)}ms. Consider debouncing/throttling event handlers and deferring non-critical work.`,
            metric: 'inp',
          });
        }
      }

      if (metrics.fcp && metrics.fcp > this.THRESHOLDS.fcp.poor) {
        recs.push({
          severity: 'critical',
          title: 'Speed up First Contentful Paint',
          description: `FCP is ${(metrics.fcp / 1000).toFixed(1)}s (target: <1.8s). Eliminate render-blocking resources, inline critical CSS, and reduce server response time.`,
          metric: 'fcp',
        });
      }

      if (metrics.tbt && metrics.tbt > this.THRESHOLDS.tbt.poor) {
        recs.push({
          severity: 'critical',
          title: 'Reduce Total Blocking Time',
          description: `TBT is ${Math.round(metrics.tbt)}ms (target: <200ms). Break up long tasks, defer unused JavaScript, and minimize main thread work.`,
          metric: 'tbt',
        });
      } else if (metrics.tbt && metrics.tbt > this.THRESHOLDS.tbt.good) {
        recs.push({
          severity: 'warning',
          title: 'Reduce blocking time',
          description: `TBT is ${Math.round(metrics.tbt)}ms. Consider code-splitting and lazy loading non-critical scripts.`,
          metric: 'tbt',
        });
      }

      if (metrics.renderBlocking && metrics.renderBlocking.length > 0) {
        recs.push({
          severity: 'warning',
          title: `${metrics.renderBlocking.length} render-blocking resource(s) detected`,
          description: 'Inline critical CSS, defer non-critical stylesheets, and use async/defer for scripts.',
          metric: 'renderBlocking',
        });
      }

      if (metrics.thirdParty && metrics.thirdParty.length > 3) {
        const totalThirdPartySize = metrics.thirdParty.reduce((sum, tp) => sum + tp.totalSize, 0);
        recs.push({
          severity: 'warning',
          title: `${metrics.thirdParty.length} third-party scripts detected`,
          description: `Third-party scripts total ${(totalThirdPartySize / 1024).toFixed(1)}KB. Consider lazy loading, self-hosting, or removing unused scripts.`,
          metric: 'thirdParty',
        });
      }

      if (metrics.domStats && metrics.domStats.elementCount > 1500) {
        recs.push({
          severity: 'warning',
          title: 'Large DOM tree',
          description: `DOM has ${metrics.domStats.elementCount} elements (target: <1,500). Reduce DOM depth and remove unnecessary nodes.`,
          metric: 'dom',
        });
      }

      if (metrics.domStats && metrics.domStats.maxDepth > 15) {
        recs.push({
          severity: 'info',
          title: 'Deep DOM nesting',
          description: `DOM depth is ${metrics.domStats.maxDepth} levels. Flatten the structure where possible for better selector performance.`,
          metric: 'dom',
        });
      }

      if (metrics.navigation) {
        const nav = metrics.navigation;
        if (nav.ttfb > 800) {
          recs.push({
            severity: 'warning',
            title: 'Slow server response time',
            description: `TTFB is ${Math.round(nav.ttfb)}ms (target: <800ms). Consider server-side caching, CDN, or database optimization.`,
            metric: 'ttfb',
          });
        }
        if (nav.redirectCount > 0) {
          recs.push({
            severity: 'info',
            title: `${nav.redirectCount} redirect(s) detected`,
            description: `Redirects add ${(nav.redirectTime / 1000).toFixed(2)}s. Update links to point directly to the final URL.`,
            metric: 'redirects',
          });
        }
      }

      if (metrics.resources) {
        const largeResources = metrics.resources.filter((r) => r.transferSize > 500 * 1024);
        if (largeResources.length > 0) {
          recs.push({
            severity: 'warning',
            title: `${largeResources.length} oversized resource(s) (>500KB)`,
            description: 'Compress images, minify bundles, and enable gzip/brotli compression.',
            metric: 'largeResources',
          });
        }

        const uncompressedImages = metrics.resources.filter(
          (r) => r.type === 'image' && !r.name.includes('.webp') && !r.name.includes('.avif') && r.transferSize > 100 * 1024
        );
        if (uncompressedImages.length > 0) {
          recs.push({
            severity: 'info',
            title: 'Use modern image formats',
            description: `${uncompressedImages.length} image(s) could use WebP/AVIF for ~30% smaller file sizes.`,
            metric: 'images',
          });
        }
      }

      if (recs.length === 0) {
        recs.push({
          severity: 'info',
          title: 'Looking good!',
          description: 'No major performance issues detected. Keep up the good work.',
          metric: 'general',
        });
      }

      return recs.sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return (order[a.severity] || 3) - (order[b.severity] || 3);
      });
    },

    compareWithPrevious(current, previous) {
      if (!previous) return null;

      const comparison = {};

      for (const metric of ['lcp', 'inp', 'cls', 'fcp', 'tti', 'tbt', 'si']) {
        let currentVal = null;
        let previousVal = null;

        if (metric === 'lcp') {
          currentVal = current.lcp ? current.lcp.value : null;
          previousVal = previous.lcp ? previous.lcp.value : null;
        } else if (metric === 'inp') {
          currentVal = current.inp ? current.inp.value : null;
          previousVal = previous.inp ? previous.inp.value : null;
        } else if (metric === 'cls') {
          currentVal = current.cls ? current.cls.value : null;
          previousVal = previous.cls ? previous.cls.value : null;
        } else {
          currentVal = current[metric] || null;
          previousVal = previous[metric] || null;
        }

        if (currentVal !== null && previousVal !== null) {
          const diff = currentVal - previousVal;
          const pct = previousVal > 0 ? (diff / previousVal) * 100 : 0;
          comparison[metric] = {
            current: currentVal,
            previous: previousVal,
            diff,
            percentChange: Math.round(pct),
            improved: metric === 'cls' ? diff < 0 : diff < 0,
          };
        }
      }

      return comparison;
    },

    analyzePerformance(metrics) {
      const analysis = this.calculateScore(metrics);
      analysis.recommendations = this.generateRecommendations(metrics, analysis);

      if (metrics.resources) {
        analysis.resourceBreakdown = this.analyzeResourceBreakdown(metrics.resources);
        analysis.slowestResources = this.findSlowestResources(metrics.resources);
        analysis.totalRequests = metrics.resources.length;
        analysis.totalTransferSize = metrics.resources.reduce((sum, r) => sum + r.transferSize, 0);
      }

      return analysis;
    },

    analyzeResourceBreakdown(resources) {
      const breakdown = { js: 0, css: 0, image: 0, font: 0, other: 0 };
      const breakdownSize = { js: 0, css: 0, image: 0, font: 0, other: 0 };

      for (const res of resources) {
        breakdown[res.type] = (breakdown[res.type] || 0) + 1;
        breakdownSize[res.type] = (breakdownSize[res.type] || 0) + res.transferSize;
      }

      return { counts: breakdown, sizes: breakdownSize };
    },

    findSlowestResources(resources) {
      return [...resources]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 20)
        .map((r) => ({
          name: r.shortName || r.name,
          type: r.type,
          duration: r.duration,
          transferSize: r.transferSize,
          ttfb: r.ttfb,
          download: r.download,
        }));
    },

    checkPerformanceBudget(metrics, budget) {
      if (!budget) return [];

      const violations = [];
      const defaultBudget = {
        lcp: 2500,
        cls: 0.1,
        inp: 200,
        fcp: 1800,
        tbt: 200,
        si: 3400,
        totalTransferSize: 3 * 1024 * 1024,
        totalRequests: 100,
      };

      const b = { ...defaultBudget, ...budget };

      if (metrics.lcp && metrics.lcp.value > b.lcp) {
        violations.push({ metric: 'lcp', actual: metrics.lcp.value, budget: b.lcp });
      }
      if (metrics.cls && metrics.cls.value > b.cls) {
        violations.push({ metric: 'cls', actual: metrics.cls.value, budget: b.cls });
      }
      if (metrics.inp && metrics.inp.value > b.inp) {
        violations.push({ metric: 'inp', actual: metrics.inp.value, budget: b.inp });
      }
      if (metrics.resources) {
        const totalSize = metrics.resources.reduce((sum, r) => sum + r.transferSize, 0);
        if (totalSize > b.totalTransferSize) {
          violations.push({ metric: 'totalTransferSize', actual: totalSize, budget: b.totalTransferSize });
        }
        if (metrics.resources.length > b.totalRequests) {
          violations.push({ metric: 'totalRequests', actual: metrics.resources.length, budget: b.totalRequests });
        }
      }

      return violations;
    },

    getScoreColor(score) {
      if (score >= 90) return 'var(--success)';
      if (score >= 50) return 'var(--warning)';
      return 'var(--danger)';
    },

    formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    formatTime(ms) {
      if (ms === null || ms === undefined) return '--';
      if (ms < 1) return '<1ms';
      if (ms < 1000) return Math.round(ms) + 'ms';
      return (ms / 1000).toFixed(2) + 's';
    },
  };

  if (typeof window !== 'undefined') {
    window.PerfAnalyzer = Analyzer;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Analyzer;
  }
})();
