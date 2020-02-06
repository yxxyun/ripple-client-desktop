'use strict';

var util = require('util'),
    Tab = require('../client/tab').Tab;

function ColdWalletTab() {
  Tab.call(this);
}

util.inherits(ColdWalletTab, Tab);

ColdWalletTab.prototype.tabName = 'coldwallet';
ColdWalletTab.prototype.mainMenu = 'coldwallet';

ColdWalletTab.prototype.generateHtml = function () {
  return require('../../templates/tabs/tx.jade')();
};

ColdWalletTab.prototype.extraRoutes = [
  {name: '/coldwallet/:address'}
];

ColdWalletTab.prototype.angular = function (module) {
  module.controller('ColdWalletCtrl', ['$rootScope', '$routeParams', '$location', '$route', 'rpId', 'rpNetwork',
  function ($scope, $routeParams, $location, $route, id, $network) {
    $scope.sequenceNumber = 1;
    $scope.accountLoaded = false;
    $scope.accountError = false;

    var address = $routeParams.address;
    $scope.address = address;

    // If we are online, fetch account info
    var watcher = $scope.$watch('connected', function() {
      if (!$scope.connected) return;

      $network.api.getFee()
        .then(fee => {
          $scope.$apply(function() {
            $scope.networkFee = fee;
          });
          return $network.api.getServerInfo()
        })
        .then(serverInfo => {
          return $network.api.getAccountInfo(address).then(info => {
            $scope.$apply(function() {
              $scope.Balance = Number(info.xrpBalance);

              var ownerCount = info.ownerCount || 0;
              $scope.reserve =
                  Number(serverInfo.validatedLedger.reserveBaseXRP) +
                  Number(serverInfo.validatedLedger.reserveIncrementXRP) *
                  ownerCount;
              $scope.max_spend = $scope.Balance - $scope.reserve;

              // If we have a sequence number from the network, display to user
              $scope.sequenceNumber = info.sequence;
            });
          });
        })
        .then(() => {
          return $network.api.getSettings(address);
        })
        .then(settings => {
          // There are three flags the user is concerned with
          var defaultRipple = !!settings.defaultRipple;
          var requireAuth = !!settings.requireAuthorization;
          var globalFreeze = !!settings.globalFreeze;
          var accountInfo = [
            {
              setting: 'Require authorization',
              enabled: requireAuth,
              description: 'Prevent issuances from being held without authorization'
           },
            {
              setting: 'Default Ripple',
              enabled: defaultRipple,
              description: 'Allow balances in trust lines to Ripple by default'
            },
            {
              setting: 'Global Freeze',
              enabled: globalFreeze,
              description: 'Freeze all issuances'
            }
          ];

          $scope.$apply(function() {
            $scope.accountInfo = accountInfo;
            $scope.regularKeyEnabled = settings.RegularKey ? 'Yes' : 'No';
          });

          // Fetch account trustlines and determine if any should have a warning
          return $network.api.request('account_lines', {account: address}).then(lines => {
            $scope.$apply(function() {
              $scope.lines = lines.lines;
              // Display any trustlines where the flag does not match the
              // corresponding flag on the account root
              $scope.warningLines = _.reduce(lines.lines, function(result, line) {
                // Convert to boolean so undefined displays as false
                line.no_ripple = !!line.no_ripple;
                line.authorized = !!line.authorized;
                if (line.no_ripple === defaultRipple) {
                  line.warning1 += 'Rippling flag on line differs from flag on account root.';
                }
                if (line.authorized !== requireAuth) { // TODO line.authorized ?
                  line.warning2 += 'Trust line must be authorized.';
                }
                if (line.warning1 || line.warning2) {
                  result.push(line);
                }
                return result;
              }, []);
            });
          })
        })
        .then(() => {
          $scope.$apply(function() {
            $scope.accountLoaded = true;
          });
        })
        .catch(function(error) {
          console.log(error);
          $scope.$apply(function() {
            $scope.accountError = true;
          });
        });

      watcher();

    });

    $scope.refresh = function() {
      $route.reload();
    };
  }]);
};

module.exports = ColdWalletTab;
