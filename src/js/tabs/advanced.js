var util = require('util'),
    webutil = require('../util/web'),
    Tab = require('../client/tab').Tab;

var AdvancedTab = function ()
{
  Tab.call(this);
};

util.inherits(AdvancedTab, Tab);

AdvancedTab.prototype.tabName = 'advanced';
AdvancedTab.prototype.mainMenu = 'advanced';

AdvancedTab.prototype.generateHtml = function ()
{
  return require('../../templates/tabs/advanced.jade')();
};

AdvancedTab.prototype.angular = function(module)
{
  module.controller('AdvancedCtrl', ['$scope', '$rootScope', '$route', 'rpId',
                                    function ($scope, $rootScope, $route, $id)
  {
    if (!$id.loginStatus) {
      $scope.showBanner = true;
      $scope.userCredentials.account = "";
    }
    // XRP currency object.
    // {name: "XRP - Ripples", order: 146, value: "XRP"}
    var xrpCurrency = deprecated.Currency.from_json("XRP");

    $scope.xrp = {
      name: xrpCurrency.to_human({full_name:$scope.currencies_all_keyed.XRP.name}),
      code: xrpCurrency.get_iso(),
      currency: xrpCurrency
    };

    $scope.options = Options;
    $scope.optionsBackup = $.extend(true, {}, Options);
    $scope.editBlob = false;
    $scope.editMaxNetworkFee = false;
    $scope.editAcctOptions = false;
    $scope.maxFeeXRP = $scope.options.connection.maxFeeXRP;

    // TODO(lezhang): verify this is called in ServerRowCtrl
    $scope.saveSettings = function() {
      // Save in local storage
      if (!store.disabled) {
        store.set('ripple_settings', angular.toJson($scope.options));
      }
    };

    $scope.saveBlob = function() {
      $scope.saveSettings();

      $scope.editBlob = false;
      $scope.saved = false;

      // Reload
      $route.reload();
    };

    $scope.saveMaxNetworkFee = function () {
      $scope.options.connection.maxFeeXRP = $scope.maxFeeXRP;
      $scope.editMaxNetworkFee = false;

      $scope.saveSettings();

      // Reload
      $scope.$emit('serverChange');
      $route.reload();
    };

    $scope.cancelEditMaxNetworkFee = function () {
      $scope.editMaxNetworkFee = false;
      $scope.options.connection.maxFeeXRP =
          $scope.optionsBackup.connection.maxFeeXRP;
    };

    $scope.cancelEditAcctOptions = function () {
      $scope.editAcctOptions = false;
    };

  }]);

  function parseUrl(url) {
    var u = new URL(url);
    var server = {
      host: u.hostname,
      secure: u.protocol === 'wss:' ? true : false,
      port: u.port
    };
    if (!server.port) {
      server.port = server.secure ? '443' : '80';
    }
    return server;
  }

  function generateUrl(server) {
    var protocol = server.secure ? 'wss:' : 'ws:'
    var url = protocol  + '//' + server.host;
    if ((server.secure && server.port !== '443') ||
        (!server.secure && server.port !== '80')) {
      url += ':' + server.port;
    }
    return url
  }

  module.controller('ServerRowCtrl', ['$scope', '$route',
    function ($scope, $route) {
      $scope.editing = false;
      $scope.server = parseUrl($scope.options.connection.server);

      $scope.server.changePort = function(secure) {
        $scope.server.port = secure ? '443' : '80';
      }

      $scope.cancel = function () {
        $scope.editing = false;
        $scope.server = parseUrl($scope.optionsBackup.connection.server);
        $scope.options.connection.server = $scope.optionsBackup.connection.server;
      };

      $scope.noCancel = function () {
        return $scope.editing == false;
      };

      $scope.save = function () {
        $scope.editing = false;
        $scope.options.connection.server = generateUrl($scope.server);

        $scope.saveSettings();

        $scope.$emit('serverChange');

          // Reload
        $route.reload();
      };
    }
  ]);

  module.controller('ProxyCtrl', ['$scope', '$route', function($scope, $route) {
    $scope.init = function() {
      var proxy = /(https?):\/\/(([^:]*):([^@]*)@)?([^:]*)(:(\d+))?/g.exec(Options.connection.proxy);

      $scope.proxy = {};

      if (proxy) {
        $scope.proxy = {
          secure: proxy[1] === 'https',
          host: proxy[5],
          port: proxy[7],
          auth: !!(proxy[3] && proxy[4]),
          username: proxy[3],
          password: proxy[4]
        };
      }
    };

    $scope.clear = function() {
      $scope.save(true);
    };

    $scope.save = function(clear) {
      if (clear) {
        delete Options.connection.proxy;
      } else {
        Options.connection.proxy =
          ($scope.proxy.secure ? 'https' : 'http') + '://'
            + ($scope.proxy.auth && $scope.proxy.username && $scope.proxy.password
              ? $scope.proxy.username + ':' + $scope.proxy.password + '@' : '')
            + $scope.proxy.host
            + ($scope.proxy.port ? ':' + $scope.proxy.port : '');
      }

      // Save in local storage
      if (!store.disabled) {
        store.set('ripple_settings', angular.toJson(Options));
      }

      // Reload
      $route.reload();
    };

    $scope.cancel = function() {
      $scope.init();
      $scope.close();
    };

    $scope.close = function() {
      $scope.editProxy = false;
    };

    $scope.init();
  }]);
};

module.exports = AdvancedTab;
