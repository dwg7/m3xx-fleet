/*
 * m3xxフリートの状態(docs/data/fleet-status.json)をOpen MCTのドメインオブジェクト
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
            type: 'folder',
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
        container.innerHTML =
          '<div style="padding:16px;font-family:sans-serif;color:#fff;">' +
          '<h2 style="margin:0 0 8px;">' + host.id + '</h2>' +
          '<div style="display:inline-block;padding:4px 10px;border-radius:4px;background:' +
          color + ';color:#111;font-weight:bold;">' + label + '</div>' +
          '<table style="margin-top:16px;border-collapse:collapse;"><tbody>' +
          (host.role ? row('役割', host.role) : '') +
          (host.os_version ? row('OS', host.os_version) : '') +
          (host.kernel ? row('カーネル', host.kernel) : '') +
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

  var folderViewProvider = {
    key: 'fleet.summary.view',
    name: 'フリート概況',
    canView: function (domainObject) {
      return (
        domainObject.identifier.namespace === NAMESPACE &&
        domainObject.identifier.key === ROOT_KEY
      );
    },
    view: function () {
      var container;
      function render() {
        if (!container) {
          return;
        }
        fetchStatus().then(function (status) {
          var s = status.summary || {};
          container.innerHTML =
            '<div style="padding:16px;font-family:sans-serif;color:#fff;">' +
            '<h2>m3xx フリート概況</h2>' +
            '<p>健全: ' + (s.healthy != null ? s.healthy : '—') +
            ' / 要現地確認: ' + (s.needs_physical_check != null ? s.needs_physical_check : '—') +
            ' / 総数: ' + (s.total != null ? s.total : '—') + '</p>' +
            (status.freshness_note
              ? '<p style="color:#f1c40f;">⚠ ' + status.freshness_note + '</p>'
              : '') +
            '<p style="color:#888;font-size:12px;">生成時刻: ' + (status.generated_at || '—') + '</p>' +
            '<p style="color:#888;">左のツリーから各ホストを選択すると詳細が見られます。</p>' +
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
    openmct.objectViews.addProvider(hostViewProvider);
    openmct.objectViews.addProvider(folderViewProvider);
  };
})();
