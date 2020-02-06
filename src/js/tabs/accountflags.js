var util = require('util'),
    Tx = require('../util/tx'),
    Tab = require('../client/tab').Tab;

var AccountFlagsTab = function() {
  Tab.call(this);
};

util.inherits(AccountFlagsTab, Tab);

AccountFlagsTab.prototype.tabName = 'accountflags';
AccountFlagsTab.prototype.mainMenu = 'accountflags';

AccountFlagsTab.prototype.generateHtml = function() {
  return require('../../templates/tabs/accountflags.jade')();
};

AccountFlagsTab.prototype.angular = function(module) {
  // Transaction AccountRoot set/clear flags
  var setClearFlags = {
    RequireDest: 1,
    RequireAuth: 2,
    DisallowXRP: 3,
    DisableMaster: 4,
    AccountTxnID: 5,
    NoFreeze: 6,
    GlobalFreeze: 7,
    DefaultRipple: 8
  };

  // AccountRoot flags from the new Ripple lib
  var RemoteFlags = {
    passwordSpent:         0x00010000, // password set fee is spent
    requireDestinationTag: 0x00020000, // require a DestinationTag for payments
    requireAuthorization : 0x00040000, // require a authorization to hold IOUs
    disallowIncomingXRP:   0x00080000, // disallow sending XRP
    disableMasterKey:      0x00100000, // force regular key
    noFreeze:              0x00200000, // permanently disallow freezing trustlines
    globalFreeze:          0x00400000, // trustlines globally frozen
    defaultRipple:         0x00800000, // enable rippling by default
  };

  module.controller('AccountFlagsCtrl', ['$scope', 'rpId',
    function($scope, id)
  {
    if (!id.loginStatus) id.goId();

    // TODO(lezhang): Add more flags.
    $scope.flags = {
      defaultRipple: {
        edit: false,
        description: 'Enable if you plan to issue balances'
      },
      requireAuthorization: {
        edit: false,
        description: 'Enable if you require authorization for other users to extend a trust line to you'
      },
      globalFreeze: {
        edit: false,
        description: 'Enable if you want to freeze all assets issued by this account'
      },
      disallowIncomingXRP: {
        edit: false,
        description: 'Disallow XRP'
      },
      disableMasterKey: {
        edit: false,
        description: 'Disable master key'
      },
      enableTransactionIDTracking: {
        edit: false,
        description: 'Enable tracking the ID of the most recent transaction'
      }
    };

    $scope.$watch('account', function() {
      $scope.flags.defaultRipple.enabled = !!($scope.account.Flags & RemoteFlags.defaultRipple);
      $scope.flags.requireAuthorization.enabled = !!($scope.account.Flags & RemoteFlags.requireAuthorization);
      $scope.flags.globalFreeze.enabled = !!($scope.account.Flags & RemoteFlags.GlobalFreeze);
      $scope.flags.disallowIncomingXRP.enabled = !!($scope.account.Flags & RemoteFlags.disallowIncomingXRP);
      // AccountTxnID doesn't have a corresponding ledger flag
      $scope.flags.enableTransactionIDTracking.enabled = !!$scope.account.AccountTxnID;

      $scope.flags.defaultRipple.newEnabled = $scope.flags.defaultRipple.enabled;
      $scope.flags.requireAuthorization.newEnabled = $scope.flags.requireAuthorization.enabled;
      $scope.flags.globalFreeze.newEnabled = $scope.flags.globalFreeze.enabled;
      $scope.flags.disallowIncomingXRP.newEnabled = $scope.flags.disallowIncomingXRP.enabled;
      $scope.flags.disableMasterKey.newEnabled = $scope.flags.disableMasterKey.enabled;
      $scope.flags.enableTransactionIDTracking.newEnabled = $scope.flags.enableTransactionIDTracking.enabled;
    }, true);

  }]);

  module.controller('FlagCtrl', ['$scope', '$timeout', 'rpId', 'rpNetwork', 'rpKeychain',
                                 function($scope, $timeout, id, $network, keychain) {
      var flag = $scope.flag;

      $scope.save = function() {
        // Need to set flag on account_root only when chosen option is different from current setting
        if ($scope.opts.enabled !== $scope.opts.newEnabled) {
          $scope.opts.saving = true;

          var onTransactionSuccess = function(res) {
            $scope.$apply(function() {
              $scope.opts.saving = false;
              $scope.opts.edit = false;
              $scope.load_notification(flag + 'Updated');

              // Hack
              if (flag === 'enableTransactionIDTracking' &&
                  !$scope.opts.newEnabled) {
                $timeout(function() {
                  $scope.opts.enabled = false;
                  $scope.opts.newEnabled = false;
                }, 200);
              }
            });
          };

          var onTransactionError = function(res) {
            console.warn(res);
            $scope.$apply(function() {
              $scope.opts.saving = false;
              $scope.opts.engine_result = res.engine_result;
              $scope.opts.engine_result_message = res.engine_result_message;
              $scope.load_notification(flag + 'Failed');
            });
          };

          keychain.requestSecret(id.account, id.username, function(err, secret) {
            if (err) {
              console.warn(err);
              return;
            }

            $network.api.prepareSettings(id.account, {
              [flag]: $scope.opts.newEnabled,
            }, Tx.Instructions).then(prepared => {
              $network.submitTx(prepared, secret, onTransactionSuccess,
                  onTransactionError);
            }).catch(console.error);
          });
        }
      };

      $scope.cancel = function() {
        $scope.opts.edit = false;
        $scope.opts.newEnabled = $scope.opts.enabled;
      };
    }
  ]);
};

module.exports = AccountFlagsTab;
