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
          '<p style="color:#888;font-size:12px;">生成時刻: ' +
          (domainObject.fleetGeneratedAt || '—') + '</p>' +
          '</div>';
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
        (la ? '  load ' + la[0].toFixed(2) : '');
    } else {
      metrics = host.note || '';
    }
    return (
      '<a href="#/browse/fleet:' + host.id + '" ' +
      'style="text-decoration:none;color:inherit;display:block;">' +
      '<div style="background:' + color + ';color:#111;border-radius:6px;' +
      'padding:10px 12px;margin:6px;min-width:130px;box-shadow:0 1px 3px rgba(0,0,0,0.4);">' +
      '<div style="font-weight:bold;font-size:15px;">' + host.id + '</div>' +
      (host.role ? '<div style="font-size:11px;opacity:0.75;">' + host.role + '</div>' : '') +
      '<div style="margin-top:6px;font-size:12px;">' + metrics + '</div>' +
      '</div>' +
      '</a>'
    );
  }

  function andonColumnHtml(title, hosts, color) {
    return (
      '<div style="flex:1;min-width:220px;margin:0 8px;">' +
      '<div style="border-bottom:2px solid ' + color + ';padding-bottom:6px;margin-bottom:4px;">' +
      '<span style="font-weight:bold;font-size:15px;">' + title + '</span> ' +
      '<span style="color:#999;">(' + hosts.length + ')</span>' +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;">' +
      hosts.map(hostCardHtml).join('') +
      '</div>' +
      '</div>'
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
          var healthy = hosts.filter(function (h) { return h.status === 'healthy'; });
          var needsCheck = hosts.filter(function (h) { return h.status !== 'healthy'; });
          container.innerHTML =
            '<div style="padding:16px;font-family:sans-serif;color:#fff;height:100%;overflow:auto;">' +
            '<h2 style="margin-top:0;">m3xx フリート アンドンボード</h2>' +
            (status.freshness_note
              ? '<p style="color:#f1c40f;">⚠ ' + status.freshness_note + '</p>'
              : '') +
            '<div style="display:flex;flex-wrap:wrap;">' +
            andonColumnHtml('健全', healthy, STATUS_COLOR.healthy) +
            andonColumnHtml('要現地確認', needsCheck, STATUS_COLOR.needs_physical_check) +
            '</div>' +
            '<p style="color:#888;font-size:12px;margin-top:16px;">' +
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
