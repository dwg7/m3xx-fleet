/*
 * m3xxフリートの状態(data/fleet-status.json)をOpen MCTのドメインオブジェクト
 * ツリーとして見せるプラグイン。openmct.objects.addProvider() +
 * openmct.composition.addProvider() でツリーを構築し、GUIの+Createは使わない
 * (dwg7横断で確認済みの、静的な状況認識ダッシュボード向けの標準パターン)。
 */
(function () {
  var NAMESPACE = 'fleet';
  var ROOT_KEY = 'root';

  var STATUS_LABEL = {
    healthy: '健全',
    needs_physical_check: '要現地確認',
    unresponsive: '応答なし'
  };

  var STATUS_COLOR = {
    healthy: '#2ecc71',
    needs_physical_check: '#e74c3c',
    unresponsive: '#e74c3c'
  };

  // Raspberry Piの温度の目安(スロットリングは概ね80℃前後から)
  var TEMP_WARN = 70;
  var TEMP_HOT = 80;

  function tempColor(t) {
    if (t == null) {
      return '#888';
    }
    if (t >= TEMP_HOT) {
      return '#e74c3c';
    }
    if (t >= TEMP_WARN) {
      return '#f39c12';
    }
    return '#2ecc71';
  }

  function fetchStatus() {
    return fetch('data/fleet-status.json', { cache: 'no-store' }).then(function (r) {
      return r.json();
    });
  }

  // 時系列履歴(data/history.jsonl、1行1収集サイクルのコンパクトなJSON)。
  // GitHub APIやコミット履歴は一切参照しない(匿名レート制限を消費しないため、
  // 履歴の唯一の情報源はこのファイル自身)。
  function fetchHistory() {
    return fetch('data/history.jsonl', { cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.text() : '';
      })
      .then(function (text) {
        if (!text) {
          return [];
        }
        return text
          .split('\n')
          .filter(function (line) { return line.trim(); })
          .map(function (line) {
            try {
              return JSON.parse(line);
            } catch (e) {
              return null;
            }
          })
          .filter(Boolean);
      })
      .catch(function () {
        return [];
      });
  }

  function hostSeries(history, hostId, field) {
    return history.map(function (entry) {
      var h = entry.h && entry.h[hostId];
      var v = h && typeof h[field] === 'number' ? h[field] : undefined;
      return { t: entry.t, v: v };
    });
  }

  // 自前SVGスパークライン(Open MCT純正のPlot APIはdwg7内の実績が不安定なため不採用)
  function sparklineSvg(series, opts) {
    opts = opts || {};
    var width = opts.width || 260;
    var height = opts.height || 48;
    var pts = series.filter(function (p) { return typeof p.v === 'number'; });
    if (pts.length < 2) {
      return '<div style="color:#666;font-size:11px;">データ不足(蓄積中です)</div>';
    }
    var values = pts.map(function (p) { return p.v; });
    var min = opts.min != null ? opts.min : Math.min.apply(null, values);
    var max = opts.max != null ? opts.max : Math.max.apply(null, values);
    if (min === max) {
      max = min + 1;
    }
    var stepX = width / (pts.length - 1);
    var coords = pts
      .map(function (p, i) {
        var x = i * stepX;
        var y = height - ((p.v - min) / (max - min)) * height;
        return x.toFixed(1) + ',' + y.toFixed(1);
      })
      .join(' ');
    var guidesSvg = (opts.guides || [])
      .map(function (g) {
        var y = height - ((g.value - min) / (max - min)) * height;
        if (y < 0 || y > height) {
          return '';
        }
        return (
          '<line x1="0" y1="' + y.toFixed(1) + '" x2="' + width + '" y2="' + y.toFixed(1) +
          '" stroke="' + g.color + '" stroke-dasharray="2,2" stroke-width="1" opacity="0.6" />'
        );
      })
      .join('');
    var last = pts[pts.length - 1].v;
    return (
      '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height +
      '" style="display:block;">' +
      guidesSvg +
      '<polyline points="' + coords + '" fill="none" stroke="' + (opts.color || '#3498db') +
      '" stroke-width="2" />' +
      '</svg>' +
      '<div style="font-size:11px;color:#999;">直近: ' + last.toFixed(2) +
      '(' + pts.length + '点、最大' + (opts.maxLines || 1000) + '点=約' +
      Math.round((opts.maxLines || 1000) * (opts.intervalHours || 2) / 24) + '日分保持)</div>'
    );
  }

  var objectProvider = {
    get: function (identifier) {
      return fetchStatus().then(function (status) {
        if (identifier.key === ROOT_KEY) {
          return {
            identifier: identifier,
            name: 'm3xx フリート',
            type: 'fleet.root',
            location: 'ROOT'
          };
        }
        var host = status.hosts.filter(function (h) {
          return h.id === identifier.key;
        })[0];
        if (!host) {
          throw new Error('unknown fleet object: ' + identifier.key);
        }
        return {
          identifier: identifier,
          name: host.id,
          type: 'fleet.host',
          location: NAMESPACE + ':' + ROOT_KEY,
          fleetHost: host,
          fleetGeneratedAt: status.generated_at,
          fleetFreshnessNote: status.freshness_note
        };
      });
    }
  };

  var compositionProvider = {
    appliesTo: function (domainObject) {
      return (
        domainObject.identifier.namespace === NAMESPACE &&
        domainObject.identifier.key === ROOT_KEY
      );
    },
    load: function () {
      return fetchStatus().then(function (status) {
        return status.hosts.map(function (h) {
          return { namespace: NAMESPACE, key: h.id };
        });
      });
    }
  };

  function row(label, value) {
    return (
      '<tr><td style="padding:4px 12px 4px 0;color:#9a9a9a;">' +
      label +
      '</td><td>' +
      value +
      '</td></tr>'
    );
  }

  var hostViewProvider = {
    key: 'fleet.host.view',
    name: 'フリートホスト状態',
    canView: function (domainObject) {
      return domainObject.type === 'fleet.host';
    },
    view: function (domainObject) {
      var container;
      function render() {
        if (!container) {
          return;
        }
        var host = domainObject.fleetHost;
        var color = STATUS_COLOR[host.status] || '#95a5a6';
        var label = STATUS_LABEL[host.status] || host.status;
        var temp = host.temperature_c;
        var tempHtml = temp != null
          ? '<span style="color:' + tempColor(temp) + ';font-weight:bold;">' + temp.toFixed(1) + ' ℃</span>'
          : '—';
        var loadHtml = host.load_average
          ? host.load_average.map(function (v) { return v.toFixed(2); }).join(' / ')
          : '—';
        container.innerHTML =
          '<div style="padding:16px;font-family:sans-serif;color:#fff;">' +
          '<h2 style="margin:0 0 8px;">' + host.id + '</h2>' +
          '<div style="display:inline-block;padding:4px 10px;border-radius:4px;background:' +
          color + ';color:#111;font-weight:bold;">' + label + '</div>' +
          '<table style="margin-top:16px;border-collapse:collapse;"><tbody>' +
          (host.role ? row('役割', host.role) : '') +
          (host.os_version ? row('OS', host.os_version) : '') +
          (host.kernel ? row('カーネル', host.kernel) : '') +
          (host.uptime ? row('uptime', host.uptime) : '') +
          (host.status === 'healthy' ? row('load average (1/5/15分)', loadHtml) : '') +
          (host.status === 'healthy' ? row('温度', tempHtml) : '') +
          row('最終確認', host.last_seen || '—') +
          (host.note ? row('備考', host.note) : '') +
          '</tbody></table>' +
          (domainObject.fleetFreshnessNote
            ? '<p style="color:#f1c40f;">⚠ ' + domainObject.fleetFreshnessNote + '</p>'
            : '') +
          '<div id="fleet-spark-temp" style="margin-top:16px;"></div>' +
          '<div id="fleet-spark-load" style="margin-top:12px;"></div>' +
          '<p style="color:#888;font-size:12px;">生成時刻: ' +
          (domainObject.fleetGeneratedAt || '—') + '</p>' +
          '</div>';

        fetchHistory().then(function (history) {
          if (!container) {
            return;
          }
          var tempEl = container.querySelector('#fleet-spark-temp');
          var loadEl = container.querySelector('#fleet-spark-load');
          if (tempEl) {
            tempEl.innerHTML =
              '<h3 style="font-size:13px;color:#ccc;margin:0 0 4px;">温度推移</h3>' +
              sparklineSvg(hostSeries(history, host.id, 'temp'), {
                min: 30,
                max: 95,
                color: '#e74c3c',
                guides: [
                  { value: TEMP_WARN, color: '#f39c12' },
                  { value: TEMP_HOT, color: '#e74c3c' }
                ]
              });
          }
          if (loadEl) {
            loadEl.innerHTML =
              '<h3 style="font-size:13px;color:#ccc;margin:0 0 4px;">load average(1分)推移</h3>' +
              sparklineSvg(hostSeries(history, host.id, 'load1'), { color: '#3498db' });
          }
        });
      }
      return {
        show: function (el) {
          container = el;
          render();
        },
        destroy: function () {
          container = undefined;
        }
      };
    }
  };

  function hostCardHtml(host) {
    var color = STATUS_COLOR[host.status] || '#95a5a6';
    var metrics;
    if (host.status === 'healthy') {
      var temp = host.temperature_c;
      var la = host.load_average;
      metrics =
        (temp != null
          ? '<span style="color:' + tempColor(temp) + ';font-weight:bold;">' + temp.toFixed(1) + '℃</span>'
          : '') +
        (la ? ' L' + la[0].toFixed(2) : '');
    } else {
      metrics = STATUS_LABEL[host.status] || host.status;
    }
    // "研修機"は大半のホストに共通する既定値なので、タイルでは省略して密度を上げる。
    // 特別な役割(踏み台・副回線)だけ表示する。
    var roleHtml =
      host.role && host.role !== '研修機'
        ? '<div style="font-size:10px;opacity:0.75;white-space:nowrap;overflow:hidden;' +
          'text-overflow:ellipsis;">' + host.role + '</div>'
        : '';
    return (
      '<a href="#/browse/fleet:' + host.id + '" ' +
      'style="text-decoration:none;color:inherit;">' +
      '<div style="background:' + color + ';color:#111;border-radius:6px;' +
      'padding:8px;height:100%;box-sizing:border-box;box-shadow:0 1px 3px rgba(0,0,0,0.4);">' +
      '<div style="font-weight:bold;font-size:14px;">' + host.id + '</div>' +
      roleHtml +
      '<div style="margin-top:4px;font-size:11px;">' + metrics + '</div>' +
      '</div>' +
      '</a>'
    );
  }

  var andonViewProvider = {
    key: 'fleet.andon.view',
    name: 'アンドンボード',
    canView: function (domainObject) {
      return domainObject.type === 'fleet.root';
    },
    view: function () {
      var container;
      function render() {
        if (!container) {
          return;
        }
        fetchStatus().then(function (status) {
          var hosts = status.hosts || [];
          var healthy = hosts.filter(function (h) { return h.status === 'healthy'; }).length;
          var needsCheck = hosts.length - healthy;
          container.innerHTML =
            '<div style="padding:12px;font-family:sans-serif;color:#fff;height:100%;' +
            'box-sizing:border-box;display:flex;flex-direction:column;">' +
            '<h2 style="margin:0 0 4px;font-size:16px;">m3xx フリート アンドンボード' +
            '<span style="font-weight:normal;color:#999;font-size:13px;"> ' +
            '(健全 ' + healthy + ' / 要現地確認 ' + needsCheck + ' / 全' + hosts.length + '台)' +
            '</span></h2>' +
            (status.freshness_note
              ? '<p style="color:#f1c40f;margin:2px 0;">⚠ ' + status.freshness_note + '</p>'
              : '') +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(96px, 1fr));' +
            'grid-auto-rows:64px;gap:6px;margin-top:6px;">' +
            hosts.map(hostCardHtml).join('') +
            '</div>' +
            '<p style="color:#888;font-size:11px;margin:8px 0 0;">' +
            '生成時刻: ' + (status.generated_at || '—') +
            '  ・カードをクリックするとホスト詳細に移動します。' +
            '</p>' +
            '</div>';
        });
      }
      return {
        show: function (el) {
          container = el;
          render();
        },
        destroy: function () {
          container = undefined;
        }
      };
    }
  };

  window.FleetProvider = function install(openmct) {
    openmct.objects.addRoot({ namespace: NAMESPACE, key: ROOT_KEY });
    openmct.objects.addProvider(NAMESPACE, objectProvider);
    openmct.composition.addProvider(compositionProvider);
    openmct.types.addType('fleet.host', {
      name: 'フリートホスト',
      description: 'm3xxフリートの1台のRaspberry Pi',
      cssClass: 'icon-object'
    });
    openmct.types.addType('fleet.root', {
      name: 'm3xxフリート',
      description: 'm3xxフリート全体(アンドンボード)',
      cssClass: 'icon-folder'
    });
    openmct.objectViews.addProvider(hostViewProvider);
    openmct.objectViews.addProvider(andonViewProvider);
  };
})();
