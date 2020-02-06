var util = require('util'),
    webutil = require('../util/web'),
    Tab = require('../client/tab').Tab,
    Tx = require('../util/tx'),
    fs = require('fs');

var TrustTab = function ()
{
  Tab.call(this);

};

util.inherits(TrustTab, Tab);

TrustTab.prototype.tabName = 'trust';
TrustTab.prototype.mainMenu = 'fund';

TrustTab.prototype.generateHtml = function () {
  return require('../../templates/tabs/trust.jade')();
};

TrustTab.prototype.angular = function (module) {
  module.controller('TrustCtrl', ['$scope', '$timeout',
    '$routeParams', 'rpId', '$filter', 'rpNetwork', 'rpKeychain',
    function ($scope, $timeout, $routeParams, id, $filter, $network, keychain) {
      if (!id.loginStatus) {
        id.goId();
      }

      // Used in offline mode
      if (!$scope.fee) {
        $scope.fee = Number(Options.connection.maxFeeXRP);
      }

      var RemoteFlagDefaultRipple = 0x00800000;
      var AuthEnabled = 0x00040000;

      // Trust line sorting
      $scope.sorting = {
        predicate: 'balance',
        reverse: true,
        sort: function(line) {
          return $scope.sorting.predicate === 'currency' ?
            line.currency : line.balance.to_number();
        }
      };

      $scope.reset = function () {
        $scope.mode = 'main';
        $scope.addform_visible = false;
        $scope.edituser = '';
        $scope.counterparty = '';
        $scope.counterparty_address = '';
        $scope.counterparty_name = '';
        $scope.saveAddressName = '';
        $scope.error_account_reserve = false;
        $scope.addressSaved = false;
      };

      $scope.toggle_form = function () {
        if ($scope.addform_visible) {
          $scope.reset();
        } else {
          $scope.addform_visible = true;
        }
      };

      // User should not be able to grant trust if the reserve is insufficient
      $scope.$watch('account', function() {
        $scope.acctDefaultRippleFlag = ($scope.account.Flags & RemoteFlagDefaultRipple);
        // Allow user to set auth on a trustline only if their account has auth enabled
        $scope.disallowAuth = !($scope.account.Flags & AuthEnabled);
        // Client is online and RequireAuth is not set on account root
        if ($scope.disallowAuth) {
          $scope.setAuthMessage = 'This account has not enabled authorization, '
          + 'so there is no need to set authorization on a trustline.';
        } else {
          // Client is online and ReqireAuth is set on account root
          $scope.setAuthMessage = 'Authorize the other party to hold '
          + 'issuances from this account.';
        }

        $scope.can_add_trust = true;
        if (!$scope.account.Balance || !$scope.account.reserve_to_add_trust ||
            $scope.account.Balance < $scope.account.reserve_to_add_trust) {
          $scope.can_add_trust = false;
        }
      }, true);

      $scope.$watch('counterparty', function() {
        $scope.error_account_reserve = false;
        $scope.contact = webutil.getContact($scope.userBlob.data.contacts, $scope.counterparty);
        if ($scope.contact) {
          $scope.counterparty_name = $scope.contact.name;
          $scope.counterparty_address = $scope.contact.address;
        } else {
          $scope.counterparty_name = '';
          $scope.counterparty_address = $scope.counterparty;
        }
      }, true);

      /**
       * N2. Confirmation page
       */
      $scope.grant = function() {
        // set variable to show throbber
        $scope.verifying = true;
        $scope.error_account_reserve = false;

        $scope.$apply(function() {
          // hide throbber
          $scope.verifying = false;

          $scope.lineCurrencyObj = deprecated.Currency.from_human($scope.currency);
          var matchedCurrency = $scope.lineCurrencyObj.has_interest() ? $scope.lineCurrencyObj.to_hex() : $scope.lineCurrencyObj.get_iso();
          var match = /^([a-zA-Z0-9]{3}|[A-Fa-f0-9]{40})\b/.exec(matchedCurrency);

          if (!match) {
            // Currency code not recognized, should have been caught by
            // form validator.
            console.error('Currency code:', match, 'is not recognized');
            return;
          }

          if ($scope.amount === '') {
            // $scope.amount = Number(deprecated.Amount.consts.max_value);
            $scope.amount = Options.gateway_max_limit;
          }

          var amount = deprecated.Amount.from_human(
            '' + $scope.amount + ' ' + $scope.lineCurrencyObj.to_hex(),
            {reference_date: new Date(+new Date() + 5 * 60000)});

          amount.set_issuer($scope.counterparty_address);
          if (!amount.is_valid()) {
            // Invalid amount. Indicates a bug in one of the validators.
            return;
          }

          $scope.amount_feedback = amount;

          $scope.confirm_wait = true;
          $timeout(function() {
            $scope.confirm_wait = false;
          }, 1000, true);
        });
      };

      /**
       * N3. Waiting for grant result page
       */
      $scope.grant_confirmed = function() {
        var onTransactionSubmit = function(res) {
          $scope.$apply(function() {
            setEngineStatus(res, false);
            $scope.granted(res.tx_json.hash);

            // Remember currency and increase order
            for (var i = 0; i < $scope.currencies_all.length; i++) {
              if ($scope.currencies_all[i].value.toLowerCase() ===
                  $scope.amount_feedback.currency().get_iso().toLowerCase()) {
                $scope.currencies_all[i].order++;
                break;
              }
            }
          });
        };

        var onTransactionError = function(res) {
          setImmediate(function () {
            $scope.$apply(function() {
              setEngineStatus(res, true);
            });
          });
        };

        keychain.requestSecret(id.account, id.username, function(err, secret) {
          if (err) {
            console.log('Error on requestSecret: ', err);
            return;
          }

          var trustline = {
            currency: $scope.amount_feedback.currency().get_iso(),
            counterparty: $scope.amount_feedback.issuer(),
            limit: $scope.amount_feedback.to_text(),
            memos:  [{
              type: $network.api.convertStringToHex('client'),
              format: $network.api.convertStringToHex('rt' + $scope.version)
            }]
          };

          // NoRipple flag
          if ($scope.ripplingFlag === 'tfClearNoRipple') {
            trustline.ripplingDisabled = false;
          } else if ($scope.ripplingFlag === 'tfSetNoRipple') {
            trustline.ripplingDisabled = true;
          }

          // Auth flag
          if ($scope.authFlag === 'tfSetfAuth') {
            trustline.authorized = true;
          }

          // Freeze flag
          if ($scope.freezeFlag === 'tfSetFreeze') {
            trustline.frozen = true;
          } else if ($scope.freezeFlag === 'tfClearFreeze') {
            trustline.frozen = false;
          }

          $network.api.prepareTrustline(
              id.account, trustline, Tx.Instructions).then(prepared => {
            return $network.submitTx(prepared, secret, console.log,
              onTransactionError, onTransactionSubmit);
          }).catch(console.error);
        });
      };

      /**
       * N5. Granted page
       */
      $scope.granted = function(hash) {
        $scope.mode = 'granted';
        $network.api.connection.on('transaction', handleAccountEvent);

        function handleAccountEvent(e) {
          $scope.$apply(function () {
            if (e.transaction.hash === hash) {
              setEngineStatus(e, true);
              $network.api.connection.removeListener('transaction', handleAccountEvent);
              $timeout(function() {
                $scope.toggle_form();
              }, 2000);
            }
          });
        }
      };

      function setEngineStatus(res, accepted) {
        $scope.engine_result = res.engine_result;
        $scope.engine_result_message = res.engine_result_message;

        switch (res.engine_result.slice(0, 3)) {
        case 'tes':
          $scope.tx_result = accepted ? 'cleared' : 'pending';
          break;
        case 'tem':
          $scope.tx_result = 'malformed';
          break;
        case 'ter':
          $scope.tx_result = 'failed';
          break;
        case 'tec':
          $scope.tx_result = 'failed';
          break;
        case 'tel':
          $scope.tx_result = 'local';
          break;
        case 'tep':
          console.warn('Unhandled engine status encountered!');
        }
      }

      $scope.$watch('userBlob.data.contacts', function (contacts) {
        $scope.counterparty_query = webutil.queryFromContacts(contacts);
      }, true);

      $scope.currency_query = webutil.queryFromOptionsIncludingKeys($scope.currencies_all);

      $scope.reset();

      var updateAccountLines = function() {
        var obj = {};

        _.each($scope.lines, function(line) {
          if (!obj[line.currency]) {
            obj[line.currency] = { components: [] };
          }

          obj[line.currency].components.push(line);
        });

        $scope.accountLines = obj;
        return;
      };

      $scope.$on('$balancesUpdate', function() {
        updateAccountLines();
      });

      updateAccountLines();

      $scope.saveAddress = function() {
        $scope.addressSaving = true;

        var contact = {
          name: $scope.saveAddressName,
          view: $scope.counterparty_address,
          address: $scope.counterparty_address
        };

        $scope.userBlob.unshift('/contacts', contact, function(err, data) {
          $scope.$apply(function () {
            $scope.addressSaving = false;
            if (err) {
              console.log('Can\'t save the contact. ', err);
              return;
            }
            $scope.contact = data;
            $scope.addressSaved = true;
            $scope.show_save_address_form = false;
          });
        });
      };
    }]);

  module.controller('AccountRowCtrl', [
    '$scope', 'rpBooks', 'rpNetwork', 'rpId', 'rpKeychain', '$timeout',
    function ($scope, books, $network, id, keychain, $timeout) {
      $scope.validation_pattern = /^0*(([0-9]*.?[0-9]*)|(.0*[1-9][0-9]*))$/;
      var AuthEnabled = 0x00040000;

      $scope.$watch('account', function() {
        $scope.disallowAuth = !($scope.account.Flags & AuthEnabled);
      }, true);

      $scope.cancel = function () {
        $scope.editing = false;
      };

      $scope.edit_account = function() {
        $scope.editing = true;

        $scope.trust = {};
        $scope.trust.limit = Number($scope.component.limit.to_json().value);
        $scope.trust.limit_peer = Number($scope.component.limit_peer.to_json().value);
        $scope.trust.balance = String($scope.component.balance.to_json().value);
        $scope.trust.balanceAmount = $scope.component.balance;

        var currency = deprecated.Currency.from_human($scope.component.currency);

        if (currency.to_human({
            full_name: $scope.currencies_all_keyed[currency.get_iso()]})) {
          $scope.trust.currency = currency.to_human({
            full_name: $scope.currencies_all_keyed[currency]
          });
        } else {
          $scope.trust.currency = currency.to_human({
            full_name: $scope.currencies_all_keyed[currency.get_iso()].name
          });
        }

        $scope.trust.counterparty = $scope.component.account;
      };

      $scope.delete_account = function() {
        $scope.trust.loading = true;
        $scope.load_notification('removing');

        if ($scope.trust.balance !== '0') {
          $scope.trust.loading = false;
          $scope.load_notification('nonzero_balance');
          return;
        }

        var onTransactionError = function(res) {
          setImmediate(function () {
            $scope.$apply(function() {
              console.error('Transaction failed with response:', res);
              $scope.trust.loading = false;
              $scope.load_notification(
                res.result === 'tejMaxFeeExceeded' ? 'max_fee' : 'remove_error');
            });
          });
        };

        var onTransactionSubmit = function(res) {
          $scope.$apply(function() {
            $network.api.connection.on('transaction', handleAccountEvent);

            function handleAccountEvent(e) {
              // Must not be called within $scope.$apply since the $scope will
              // be gone after the trustline is removed.
              if (e.transaction.hash === res.tx_json.hash) {
                $scope.load_notification("removed");
                $network.api.connection.removeListener('transaction', handleAccountEvent);
              }
            }
          });
        };

        keychain.requestSecret(id.account, id.username, function (err, secret) {
          if (err) {
            console.error('Error on requestSecret: ', err);
            $scope.trust.loading = false;
            $scope.load_notification('remove_error');
            return;
          }

          var trustline = {
            currency: $scope.trust.currency,
            counterparty: $scope.trust.counterparty,
            limit: '0',
            memos:  [{
              type: $network.api.convertStringToHex('client'),
              format: $network.api.convertStringToHex('rt' + $scope.version)
            }],
            frozen: false,
            ripplingDisabled: !$scope.acctDefaultRippleFlag
          };

          $network.api.prepareTrustline(
              id.account, trustline, Tx.Instructions).then(prepared => {
            return $network.submitTx(prepared, secret, console.log,
              onTransactionError, onTransactionSubmit);
          }).catch(function(err) {
            console.error(err);
            $scope.trust.loading = false;
            $scope.load_notification('remove_error');
          });
        });
      };

      $scope.save_account = function () {
        $scope.trust.loading = true;
        $scope.load_notification('saving');

        var amount = deprecated.Amount.from_human(
          $scope.trust.limit + ' ' + $scope.component.currency,
          {reference_date: new Date(+new Date() + 5*60000)}
        );

        amount.set_issuer($scope.component.account);

        if (!amount.is_valid()) {
          // Invalid amount. Indicates a bug in one of the validators.
          console.log('Invalid amount');
          $scope.trust.loading = false;
          $scope.load_notification('save_error');
          return;
        }

        var onTransactionSubmit = function(res) {
          $scope.$apply(function() {
            $network.api.connection.on('transaction', handleAccountEvent);

            function handleAccountEvent(e) {
              $scope.$apply(function () {
                if (e.transaction.hash === res.tx_json.hash) {
                  $scope.trust.loading = false;
                  $scope.editing = false;
                  $scope.load_notification("saved");
                  $network.api.connection.removeListener('transaction', handleAccountEvent);
                }
              });
            }
          });
        };

        var onTransactionError = function(res) {
          setImmediate(function() {
            $scope.$apply(function() {
              console.log('Transaction failed with response:', res);
              $scope.load_notification(
                res.result === 'tejMaxFeeExceeded' ? 'max_fee' : 'save_error');
              $scope.trust.loading = false;
            });
          });
        };

        keychain.requestSecret(id.account, id.username, function (err, secret) {
          if (err) {
            console.log('Error on requestSecret: ', err);
            $scope.load_notification('save_error');
            $scope.trust.loading = false;
            return;
          }

          var trustline = {
            currency: amount.currency().get_iso(),
            counterparty: amount.issuer(),
            limit: amount.to_text(),
            memos:  [{
              type: $network.api.convertStringToHex('client'),
              format: $network.api.convertStringToHex('rt' + $scope.version)
            }]
          };

          // NoRipple flag
          if ($scope.trust.ripplingFlag === 'tfClearNoRipple') {
            trustline.ripplingDisabled = false;
          } else if ($scope.trust.ripplingFlag === 'tfSetNoRipple') {
            trustline.ripplingDisabled = true;
          }

          // Auth flag
          if ($scope.trust.authFlag === 'tfSetfAuth') {
            trustline.authorized = true;
          }

          // Freeze flag
          if ($scope.trust.freezeFlag === 'tfSetFreeze') {
            trustline.frozen = true;
          } else if ($scope.trust.freezeFlag === 'tfClearFreeze') {
            trustline.frozen = false;
          }

          $network.api.prepareTrustline(
              id.account, trustline, Tx.Instructions).then(prepared => {
            return $network.submitTx(prepared, secret, console.log,
              onTransactionError, onTransactionSubmit);
          }).catch(function(err) {
            console.error(err);
            $scope.trust.loading = false;
            $scope.load_notification('save_error');
          });
        });
      };

      $scope.isIncomingOnly = function () {
        return ($scope.component.limit.is_zero() && !$scope.component.limit_peer.is_zero());
      };

      $scope.ripplingEnabled = function() {
        return !$scope.component.no_ripple;
      };
    }]);
};

module.exports = TrustTab;
