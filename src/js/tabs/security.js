var util = require('util'),
    Tab = require('../client/tab').Tab,
    Base58Utils = require('../util/base58'),
    RippleAddress = require('../util/types').RippleAddress,
    Tx = require('../util/tx'),
    fs = require('fs');

var SecurityTab = function ()
{
  Tab.call(this);
};

util.inherits(SecurityTab, Tab);

SecurityTab.prototype.tabName = 'security';
SecurityTab.prototype.mainMenu = 'security';

SecurityTab.prototype.generateHtml = function ()
{
  return require('../../templates/tabs/security.jade')();
};

SecurityTab.prototype.angular = function (module) {
  module.controller('SecurityCtrl', ['$scope', 'rpId', 'rpKeychain', '$timeout',
    'rpAuthFlow', 'rpPopup', 'rpNetwork', 'rpFileDialog',
    function ($scope, $id, keychain, $timeout, authflow, popup, $network, fileDialog)
  {
    if (!$id.loginStatus) $id.goId();

    if(!!store.get('walletfile')) {
      $scope.walletfile = store.get('walletfile');

      // Get the name of the wallet from the entire file path
      var walletarray = $scope.walletfile.split("/");
      var length = walletarray.length;
      $scope.walletname = walletarray[length - 1];
    }

    $scope.settingsPage = 'security';

    $scope.showComponent = [];

    $scope.isUnlocked = true; //hiding the dialog for now
    //$scope.isUnlocked = keychain.isUnlocked($id.account);
    $scope.requirePasswordChanged = false;

    $scope.validation_pattern_phone = /^[0-9]*$/;

    $scope.$on('$blobUpdate', onBlobUpdate);
    onBlobUpdate();

    $scope.security = {};
    $scope.mode = {};

    function onBlobUpdate()
    {
      if ("function" === typeof $scope.userBlob.encrypt) {
        $scope.enc = $scope.userBlob.encrypt();
      }


      $scope.requirePassword = !$scope.userBlob.data.persistUnlock;
    }

    $scope.restoreSession = function() {

      if (!$scope.sessionPassword) {
        $scope.unlockError = true;
        return;
      }

      $scope.isConfirming = true;
      $scope.unlockError  = null;

      keychain.getSecret($id.account, $id.username, $scope.sessionPassword, function(err, secret) {
        $scope.isConfirming = false;
        $scope.sessionPassword = '';

        if (err) {
          $scope.unlockError = err;
          return;
        }

        $scope.isUnlocked = keychain.isUnlocked($id.account);
      });

    };


    $scope.unmaskSecret = function () {
      keychain.requestSecret($id.account, $id.username, 'showSecret', function (err, secret) {
        if (err) {
          // XXX Handle error
          return;
        }

        $scope.security.master_seed = secret;
      });
    };


    $scope.setPasswordProtection = function () {
      $scope.editUnlock = false;

      //ignore it if we are not going to change anything
      if (!$scope.requirePasswordChanged) return;
      $scope.requirePasswordChanged = false;
      $scope.requirePassword        = !$scope.requirePassword;

      keychain.setPasswordProtection($scope.requirePassword, function(err, resp){
        if (err) {
          console.log(err);
          $scope.requirePassword = !$scope.requirePassword;
          //TODO: report errors to user
        }
      });
    };

    $scope.cancelUnlockOptions = function () {
      $scope.editUnlock = false;
    };

    function requestToken (force, callback) {
      authflow.requestToken($scope.userBlob.url, $scope.userBlob.id, force, function(tokenError, tokenResp) {
        $scope.via = tokenResp.via;

        callback(tokenError, tokenResp);
      });
    }

    $scope.requestToken = function () {
      var force = $scope.via === 'app' ? true : false;

      $scope.isRequesting = true;
      requestToken(force, function(err, resp) {
        $scope.isRequesting = false;
        //TODO: present message of resend success or failure
      });
    };

    // Generate a regular key
    // And save it on the current blob
    $scope.generateRegularKey = function() {
      $scope.regularKey = Base58Utils.encode_base_check(33, sjcl.codec.bytes.fromBits(sjcl.random.randomWords(4)));
      $scope.regularKeyPublic = new RippleAddress($scope.regularKey).getAddress();

      // This is basically impossible, just in case.
      if ($scope.regularKeyPublic === $id.account) {
        console.error("Generated regular key is the same as master key");
        return;
      }

      var onTransactionSucess = function(res) {
        console.log('Set regular key success', res);
      };

      var onTransactionSubmit = function(res) {
        console.log('Set regular key submitted', res);
      };

      var onTransactionError = function(res) {
        console.log('Set regular key error', res);
      };

      // Attach the key to the account
      keychain.requestSecret($id.account, $id.username, function (err, secret) {
        if (err) {
          console.error(err);
          return;
        }

        $network.api.prepareSettings($id.account,{
          regularKey: $scope.regularKeyPublic
        }, Tx.Instructions).then(prepared => {
          $network.submitTx(prepared, secret, onTransactionSucess,
              onTransactionError, onTransactionSubmit);
        }).catch(console.error)
      });

      // Save the key in the blob
      $scope.userBlob.set("/regularKey", $scope.regularKey);
    };

    // Remove regular key from master wallet file
    // Unset regular key with Ripple transaction, so key is no longer valid
    $scope.removeRegularKey = function() {
      var onTransactionSucess = function(res) {
        console.log('Remove regular key success: ', res);
      };

      var onTransactionSubmit = function(res) {
        console.log('Remove regular key submitted: ', res);
      };

      var onTransactionError = function(res) {
        console.log('Remove regular key error: ', res);
      };

      keychain.requestSecret($id.account, $id.username, function (err, secret) {
        if (err) {
          console.error(err);
          return;
        }

        // TODO(lezhang): tell user the key is removed only on success.
        $network.api.prepareSettings($id.account,{
          regularKey: null
        }, Tx.Instructions).then(prepared => {
          $network.submitTx(prepared, secret, onTransactionSucess,
              onTransactionError, onTransactionSubmit);
        }).catch(console.error)
      });

      // Remove the key from the blob
      $scope.userBlob.unset("/regularKey");
    };

    // Chose file in which to save the regular key wallet
    $scope.saveRegularKey = function() {
      fileDialog.saveAs(function(filename) {
        $scope.$apply(function() {
          $scope.regularWallet = filename;
          $scope.mode.register_regular_key_wallet = true;
        });
      }, $scope.walletname + '-regular');
    };

    // Encrypt a new blob containing the regular key only
    // (no master key) with a passwork of the user's choosing
    // Save this blob to disk
    $scope.encryptRegularKey = function() {
      $scope.userBlob.persistRegular($scope.regularWallet,
        $scope.password1, function(err, data) {
          $scope.$apply(function() {
            $scope.mode.register_regular_key_wallet = false;
            if (err) {
              console.log('Error saving wallet: ', err);
              $scope.mode.error_regular_key_wallet = true;
            } else {
              $scope.mode.saved_regular_key_wallet = true;
            }
          });
        });
    };

    var reset = function() {
      $scope.openFormPassword = false;
      $scope.password1 = '';
      $scope.password2 = '';
      $scope.passwordSet = {};

      if ($scope.changeForm) {
        $scope.changeForm.$setPristine(true);
      }
  };

  reset();
  $scope.success = false;

  }]);
};

module.exports = SecurityTab;
