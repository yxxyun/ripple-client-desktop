var util = require('util'),
    webutil = require('../util/web'),
    Tab = require('../client/tab').Tab,
    Tx = require('../util/tx'),
    fs = require('fs');    

var SendTab = function ()
{
  Tab.call(this);
};

util.inherits(SendTab, Tab);

SendTab.prototype.tabName = 'send';
SendTab.prototype.mainMenu = 'send';

SendTab.prototype.angularDeps = Tab.prototype.angularDeps.concat(['keychain']);

SendTab.prototype.generateHtml = function ()
{
  return require('../../templates/tabs/send.jade')();
};

SendTab.prototype.angular = function (module)
{
  module.controller('SendCtrl', ['$scope', '$timeout', '$routeParams', 'rpId',
                                 'rpNetwork', 'rpKeychain', 
                                 function ($scope, $timeout, $routeParams, $id,
                                           $network, keychain)
  {
    if (!$id.loginStatus) $id.goId();

    var timer;

    // XRP currency object.
    // {name: "XRP - Ripples", order: 146, value: "XRP"}
    var xrpCurrency = deprecated.Currency.from_json("XRP");

    $scope.xrp = {
      name: xrpCurrency.to_human({full_name:$scope.currencies_all_keyed["XRP"].name}),
      code: xrpCurrency.get_iso(),
      currency: xrpCurrency
    };

    $scope.$watch('send.recipient', function(){
      // raw address without any parameters
      var address = webutil.stripRippleAddress($scope.send.recipient);

      $scope.contact = webutil.getContact($scope.userBlob.data.contacts, address);

      // Sets
      // send.recipient, send.recipient_name, send.recipient_address, send.dt.
      if ($scope.contact) {
        if ($scope.send.recipient === $scope.contact.address) {
          $scope.send.recipient = $scope.contact.name;
        }
        $scope.send.recipient_name = $scope.contact.name;
        $scope.send.recipient_address = $scope.contact.address;

        if ($scope.contact.dt) {
          $scope.send.dt = $scope.contact.dt;
        }
      }
      else {
        $scope.send.recipient_name = '';
        $scope.send.recipient_address = address;
      }

      $scope.update_destination();
    }, true);

    $scope.$watch('send.currency', function () {
      var currency = deprecated.Currency.from_json($scope.send.currency);
      if ($scope.send.currency !== '' && currency.is_valid()) {
        $scope.send.currency_code = currency.to_human().toUpperCase();
      } else {
        $scope.send.currency_code = '';
      }
      $scope.update_currency();
    }, true);

    $scope.$watch('send.amount', function () {
      $scope.update_amount();
    }, true);

    $scope.$watch('send.extra_fields', function () {
      $scope.update_amount();
    }, true);

    // When the send form is invalid, path finding won't trigger. So if the form
    // is changed by one of the update_* handlers and becomes valid during the
    // next digest, we need to manually trigger another update_amount.
    $scope.$watch('sendForm.$valid', function () {
      $scope.update_amount();
    });

    var destUpdateTimeout;

    // Reset everything that depends on the destination
    $scope.reset_destination_deps = function() {
      var send = $scope.send;
      send.self = false;
      send.fund_status = "none";
      send.extra_fields = [];

      // Reset federation address validity status
      if ($scope.sendForm && $scope.sendForm.send_destination)
        $scope.sendForm.send_destination.$setValidity("federation", true);

      // Now starting to work on resolving the recipient
      send.recipient_resolved = false;
      send.recipient_actual = void(0);
      send.amount_actual = void(0);

      $scope.reset_currency_deps();
    };

    $scope.check_dt_visibility = function () {
      var send = $scope.send;

      send.show_dt_field =
          ($routeParams.dt
          || send.dt
          || (send.recipient_info &&
          'object' === typeof send.recipient_info &&
          send.recipient_info.dest_tag_required));
    };

    $scope.update_destination = function () {
      var send = $scope.send;
      var recipient = send.recipient_address;

      if (recipient === send.last_recipient) return;

      send.last_recipient = recipient;

      $scope.reset_destination_deps();

      // Trying to send XRP to self.
      // This is used to disable 'Send XRP' button
      send.self = recipient === $scope.address;

      // Check destination tag visibility
      $scope.check_dt_visibility();

      if (destUpdateTimeout) {
        $timeout.cancel(destUpdateTimeout);
      }
      destUpdateTimeout = $timeout($scope.update_destination_remote, 500);
    };

    $scope.update_destination_remote = function () {
      var send = $scope.send;
      var recipient = send.recipient_address;

      // Reset federation address validity status
      if ($scope.sendForm && $scope.sendForm.send_destination) {
        $scope.sendForm.send_destination.$setValidity("federation", true);
      }

      $scope.check_destination();
    };

    // Check destination for XRP sufficiency and flags
    $scope.check_destination = function () {
      var send = $scope.send;
      var recipient = send.recipient_actual || send.recipient_address;

      if (!RippleAddressCodec.isValidAddress(recipient)) return;

      send.path_status = 'checking';
      send.recipient_info = null;

      $network.api.getAccountInfo(recipient).then(info => {
        $network.api.getSettings(recipient).then(settings => {
          $scope.$apply(function () {
            // Check if this request is still current, exit if not
            var now_recipient = send.recipient_actual || send.recipient_address;
            if (recipient !== now_recipient) return;

            // If we get this far, we have a Ripple address resolved
            send.recipient_resolved = true;

            send.recipient_info = {
              'loaded': true,
              'exists': true,
              'Balance': info.xrpBalance,

              // Flags
              'disallow_xrp': settings.disallowIncomingXRP,
              'dest_tag_required': settings.requireDestinationTag,
            };

            // Check destination tag visibility
            $scope.check_dt_visibility();

            if (!$scope.account || !$scope.account.reserve_base) return;

            var reserve_base = $scope.account.reserve_base;
            send.xrp_deficiency = reserve_base - Number(info.xrpBalance);

            send.recipient_lines = false;
            $scope.update_currency_constraints();
          });
        });
      }).catch(error => {
        $scope.$apply(function () {
          if (error.data.error === "actNotFound") {
            send.recipient_info = {
              'loaded': true,
              'exists': false,
              'Balance': "0"
            };
            $scope.update_currency_constraints();
          } else {
            console.error(error);
          }
        })
      })
    };

    /**
     * Update any constraints on what currencies the user can select.
     *
     * In many modes, the user is restricted in terms of what they can send.
     *
     * This function checks those conditions and updates the UI.
     */
    $scope.update_currency_constraints = function () {
      var send = $scope.send;

      // Reset constraints
      send.currency_choices = $scope.currencies_all;
      send.currency_force = false;

      send.currency_choices_constraints = {};

      // If we don't have information about the recipient Ripple account yet,
      // we'll just return. We'll get back here once we have that information.
      if (!send.recipient_info.loaded) return;

      if (send.recipient_info.exists) {
        // Check allowed currencies for this address
        var requestedRecipientAddress = send.recipient_address;
        send.currency_choices_constraints.accountLines = 'pending';
        $network.api.request('account_currencies', {
          account: requestedRecipientAddress,
          ledger_index: 'validated'
        }).then(response => {
            $scope.$apply(function () {
              if (response.receive_currencies &&
                  // We need to make sure the destination account hasn't changed
                  send.recipient_address === requestedRecipientAddress) {
                send.currency_choices_constraints.accountLines = response.receive_currencies;

                // add XRP if it's allowed
                if (!$scope.send.recipient_info.disallow_xrp) {
                  send.currency_choices_constraints.accountLines.unshift('XRP');
                }

                $scope.update_currency_choices();
              }
            });
        }).catch(function(error) {
          console.log("Error request 'account_currencies': ", error);
        })
      } else {
        // If the account doesn't exist, we can only send XRP
        send.currency_choices_constraints.accountLines = ["XRP"];
      }

      $scope.update_currency_choices();
    };

    // Generate list of accepted currencies
    $scope.update_currency_choices = function() {
      var send = $scope.send;

      var currencies = [];

      // Make sure none of the currency_choices_constraints are pending
      if (_.includes(_.values(send.currency_choices_constraints), 'pending')) {
        send.path_status = 'account-currencies';
        send.currency_choices = [];
        return;
      } else {
        // The possible currencies are the intersection of all provided currency
        // constraints.
        currencies = _.values(send.currency_choices_constraints);
        if (currencies.length == 1) {
          currencies = currencies[0];
        } else {
          currencies = _.intersection.apply(_, currencies);
        }
        currencies = _.uniq(_.compact(currencies));

        // create the display version of the currencies
        currencies = _.map(currencies, function (currency) {
         // create a currency object for each of the currency codes
          var currencyObj = deprecated.Currency.from_json(currency);
          if ($scope.currencies_all_keyed[currencyObj.get_iso()]) {
            return currencyObj.to_human({full_name:$scope.currencies_all_keyed[currencyObj.get_iso()].name});
          } else {
            return currencyObj.to_human();
          }
        });
      }

      if (currencies.length === 1) {
        send.currency = send.currency_force = currencies[0];
      } else if (currencies.length === 0) {
        send.path_status = 'error-no-currency';
        send.currency = '';
      } else {
        send.currency_force = false;

        if (currencies.indexOf(send.currency) === -1) {
          send.currency = currencies[0];
        }
      }

      $scope.send.currency_choices = currencies;
      $scope.update_currency();
    };

    // Reset anything that depends on the currency
    $scope.reset_currency_deps = function () {
      // XXX Reset

      $scope.reset_amount_deps();
    };

    $scope.update_currency = function () {
      var send = $scope.send;
      var recipient = send.recipient_actual || send.recipient_address;
      var currency = send.currency;

      $scope.reset_currency_deps();

      // We should have a valid recipient
      if (!RippleAddressCodec.isValidAddress(recipient) && !send.quote_url) {
        return;
      }

      if (!send.currency_choices ||
          send.currency_choices.length === 0) {
        return;
      }

      $scope.update_amount();
    };

    var pathUpdateTimeout;

    $scope.reset_amount_deps = function () {
      var send = $scope.send;
      send.sender_insufficient_xrp = false;

      $scope.reset_paths();
    };

    $scope.update_amount = function () {
      $network.api.request('path_find', {subcommand: 'close'}).catch(error => {});
      var send = $scope.send;
      var recipient = send.recipient_actual || send.recipient_address;

      if (!send.currency_choices ||
          send.currency_choices.length === 0) {
        return;
      }

      var currency = deprecated.Currency.from_human(send.currency);
      var matchedCurrency = currency.has_interest() ? currency.to_hex() : currency.get_iso();
      var match = /^([a-zA-Z0-9]{3}|[A-Fa-f0-9]{40})\b/.exec(matchedCurrency);

      if (!match) {
        // Currency code not recognized, should have been caught by
        // form validator.
        return;
      }

      var amount = send.amount_feedback = deprecated.Amount.from_human('' + send.amount + ' ' + matchedCurrency);

      $scope.reset_amount_deps();
      send.path_status = 'waiting';

      // If there is a timeout in progress, we want to cancel it, since the
      // inputs have changed.
      if (pathUpdateTimeout) $timeout.cancel(pathUpdateTimeout);

      // If the form is invalid, we won't be able to submit anyway, so no point
      // in calculating paths.
      if ($scope.sendForm.$invalid) return;

      if (send.quote_url) {
        if (!send.amount_feedback.is_valid())
          return;

        // Dummy issuer
        send.amount_feedback.set_issuer(1);
        pathUpdateTimeout = $timeout($scope.update_quote, 500);
      } else {
        if (!RippleAddressCodec.isValidAddress(recipient) || !deprecated.Amount.is_valid(amount)) {
          // XXX Error?
          return;
        }

        // Create Amount object
        if (!send.amount_feedback.is_native()) {
          send.amount_feedback.set_issuer(recipient);
        }

        // If we don't have recipient info yet, then don't search for paths
        if (!send.recipient_info) {
          return;
        }

        // Cannot make XRP payment if the sender does not have enough XRP
        send.sender_insufficient_xrp = send.amount_feedback.is_native()
          && $scope.account.max_spend
          && $scope.account.max_spend > 1
          && $scope.account.max_spend < send.amount_feedback.to_number()/1000000;

        var total = send.amount_feedback.add(send.recipient_info.Balance * 1000000);
        var reserve_base = deprecated.Amount.from_json($scope.account.reserve_base);

        if (total.is_comparable(reserve_base) && total.compareTo(reserve_base) < 0) {
          send.fund_status = "insufficient-xrp";
          send.xrp_deficiency = $scope.account.reserve_base - Number(send.recipient_info.Balance);
          send.insufficient = true;
          return;
        }
        send.insufficient = false;
        send.fund_status = 'none';

        send.path_status = 'pending';
        pathUpdateTimeout = $timeout($scope.update_paths, 500);
      }
    };

    $scope.reset_paths = function () {
      var send = $scope.send;

      send.alternatives = [];
    };


    $scope.update_paths = function () {
      var send = $scope.send;
      var recipient = send.recipient_actual || send.recipient_address;
      var amount = send.amount_actual || send.amount_feedback;

      $scope.reset_paths();

      send.path_status = 'pending';

      // Determine if we need to update the paths.
      if (send.pathfind &&
          send.pathfind.src_account === $id.account &&
          send.pathfind.dst_account === recipient &&
          send.pathfind.dst_amount.equals(amount)) {
        return;
      }

      send.pathfind = {
        src_account: $id.account,
        dst_account: recipient,
        dst_amount: amount
      };

      var isIssuer = $scope.generate_issuer_currencies();

      var lastUpdate;

      var updatePath = function(upd) {
        $scope.$apply(function () {
          lastUpdate = new Date();
          clearInterval(timer);
          timer = setInterval(function() {
            $scope.$apply(function() {
              var seconds = Math.round((new Date() - lastUpdate) / 1000);
              $scope.lastUpdate = seconds ? seconds : 0;
            });
          }, 1000);

          // Check if this request is still current, exit if not
          var now_recipient = send.recipient_actual || send.recipient_address;
          if (recipient !== now_recipient) {
            return;
          }

          var now_amount = send.amount_actual || send.amount_feedback;
          if (!now_amount.equals(amount)) {
            return;
          }

          if (!upd.alternatives || !upd.alternatives.length) {
            $scope.send.path_status = 'no-path';
            $scope.send.alternatives = [];
          } else {
            var currencies = {};
            var currentAlternatives = [];

            $scope.send.path_status = 'done';
            $scope.send.alternatives = _.map(upd.alternatives, function (raw, key) {
              var alt = {};

              alt.amount = deprecated.Amount.from_json(raw.source_amount);

              alt.rate = alt.amount.ratio_human(amount);

              // Send max is 1.01 * amount
              var scaleAmount = { issuer: alt.amount._issuer };
              scaleAmount.value = 1.01;
              alt.send_max = alt.amount.scale(scaleAmount);

              alt.paths = raw.paths_computed
                ? raw.paths_computed
                : raw.paths_canonical;

              // Selected currency should be the first option
              if (raw.source_amount.currency) {
                if (raw.source_amount.currency === $scope.send.currency_code) {
                  currentAlternatives.push(alt);
                }
              } else if ($scope.send.currency_code === 'XRP') {
                currentAlternatives.push(alt);
              }
              if (alt.amount.issuer() !== $scope.address && !isIssuer[alt.amount.currency().to_hex()]) {
                currencies[alt.amount.currency().to_hex()] = true;
              }
              return alt;
            }).filter(function(alt) {
              return currentAlternatives.indexOf(alt) === -1;
            });
            Array.prototype.unshift.apply($scope.send.alternatives, currentAlternatives);
          }
        });
      };
      // Start path find
      $network.api.connection.on('path_find', updatePath);
      $network.api.request('path_find', {
        subcommand: 'create',
        source_account: $id.account,
        destination_account: recipient,
        destination_amount: amount.to_json()
      }).then(updatePath
      ).catch(error => {
        setImmediate(function () {
          $scope.$apply(function () {
            send.path_status = 'error';
          });
        });
      });
    };

    $scope.$watch('userBlob.data.contacts', function (contacts) {
      $scope.recipient_query = webutil.queryFromContacts(contacts);
    }, true);

    $scope.$watch('account.max_spend', function () {
      $scope.update_amount();
    }, true);

    $scope.reset = function () {
      $scope.mode = "form";

      // XXX Most of these variables should be properties of $scope.send.
      //     The Angular devs recommend that models be objects due to the way
      //     scope inheritance works.
      $scope.send = {
        recipient: '',
        recipient_name: '',
        recipient_address: '',
        recipient_prev: '',
        recipient_info: {},
        amount: '',
        amount_prev: new deprecated.Amount(),
        currency: $scope.xrp.name,
        currency_choices: [],
        currency_code: "XRP",
        path_status: 'waiting',
        fund_status: 'none',
        sender_insufficient_xrp: false
      };
      $scope.nickname = '';
      $scope.error_type = '';
      $scope.resetAddressForm();
      if ($scope.sendForm) $scope.sendForm.$setPristine(true);
    };

    $scope.cancelConfirm = function () {
      $scope.mode = "form";
      $scope.send.alt = null;

      // Force pathfinding reset
      $scope.update_paths();
    };

    $scope.resetAddressForm = function() {
      $scope.show_save_address_form = false;
      $scope.addressSaved = false;
      $scope.saveAddressName = '';
      $scope.addressSaving = false;
      if ($scope.saveAddressForm) $scope.saveAddressForm.$setPristine(true);
    };

    $scope.reset_goto = function (tabName) {
      $scope.reset();

      // TODO do something clever instead of document.location
      // because goToTab does $scope.$digest() which we don't need
      document.location = '#' + tabName;
    };

    /**
     * N3. Confirmation page
     */
    $scope.send_prepared = function () {
      // check if paths are available, if not then it is a direct send
      $scope.send.indirect = $scope.send.alt ? $scope.send.alt.paths.length : false;

      $scope.confirm_wait = true;
      $timeout(function () {
        $scope.confirm_wait = false;
      }, 1000, true);

      // Stop the pathfind - once we're on the confirmation page, we'll freeze
      // the last state we had so the user doesn't get surprises when
      // submitting.
      // XXX ST: The confirmation page should warn you somehow once it becomes
      //         outdated.
      $network.api.request('path_find', {subcommand: 'close'}).catch(error => {});
      $scope.mode = "confirm";

      $scope.send.secret = keychain.requestSecret($id.account);
    };

    /**
     * N4. Waiting for transaction result page
     */

    $scope.onTransactionSubmit = function(res) {
      $scope.$apply(function () {
        $scope.setEngineStatus(res, false);
        $scope.sent(res.tx_json.hash);

        // Remember currency and increase order
        var found;

        for (var i = 0; i < $scope.currencies_all.length; i++) {
          if ($scope.currencies_all[i].value.toLowerCase() === $scope.send.amount_feedback.currency().get_iso().toLowerCase()) {
            $scope.currencies_all[i].order++;
            found = true;
            break;
          }
        }

        // // Removed feature until a permanent fix
        // if (!found) {
        //   $scope.currencies_all.push({
        //     "name": $scope.send.amount_feedback.currency().to_human().toUpperCase(),
        //     "value": $scope.send.amount_feedback.currency().to_human().toUpperCase(),
        //     "order": 1
        //   });
        // }
      });
    };

    $scope.onTransactionSuccess = function(res) {
      $scope.$apply(function () {
        $scope.setEngineStatus(res, true);
      });
    };

    $scope.onTransactionError = function(res) {
      setImmediate(function () {
        $scope.$apply(function () {
          $scope.mode = "error";

          if (res.engine_result) {
            $scope.setEngineStatus(res);
          } else {
            $scope.error_type = "unknown";
            console.error(res);
          }
        });
      });
    };

    $scope.send_confirmed = function () {
      $scope.mode = "sending";

      var amount = $scope.send.amount_feedback;

      // This should not happen. In case it happens, bail out immediately
      // because RippleAPI doesn't support remote signing which has a build_path
      // option that allows rippled to choose a path automatically.
      //
      // ripple-lib core library (existed prior to 0.13.0) supported enabling
      // build_path on a transaction. See https://xrpl.org/sign.html for an
      // explanation of build_path.
      if (!amount.is_native() && !$scope.send.alt) {
        $scope.mode = "error";
        console.error("no path to send " + amount.to_json())
        return;
      }

      if (!$scope.send.secret) {
        $scope.send.secret = keychain.requestSecret($id.account);
      }

      // TODO(lezhang): dedup.
      function toAmount(amount) {
        if (amount.is_native()) {
          return {
            currency: 'drops',
            value: amount.to_text()
          }
        } else {
          return {
            currency: amount.currency().get_iso(),
            counterparty: amount.issuer(),
            value: amount.to_text()
          }
        }
      }

      var payment = {
        source: {
          address: $id.account,
          maxAmount: toAmount(amount)
        },
        destination: {
          address: $scope.send.recipient_address,
          amount: toAmount(amount)
        },
        memos: [{
          type: $network.api.convertStringToHex('client'),
          format: $network.api.convertStringToHex('rt' + $scope.version)
        }]
      };

      if ($scope.send.alt) {
        payment.source.maxAmount = toAmount($scope.send.alt.send_max);
        if ($scope.send.alt.paths.length) {
          $scope.send.alt.paths.forEach(function(path) {
            path.forEach(function(node){
              // These two properties will be removed when serializing the
              // transactions in RippleAPI. Not removing them here will cause
              // error "Serialized transaction does not match original txJSON"
              // when calling RippleAPI.sign().
              delete node.type;
              delete node.type_hex;
            });
          });
          payment.paths = JSON.stringify($scope.send.alt.paths);
        }
      }

      // Source tag
      if ($scope.send.st) {
        payment.source.tag = Number($scope.send.st);
      }

      // Destination tag
      var dt;
      if ($scope.send.dt) {
        dt = $scope.send.dt;
      } else {
        dt = webutil.getDestTagFromAddress($scope.send.recipient);
      }

      if (dt) {
        payment.destination.tag = Number(dt);
      }

      if ($scope.send.invoiceId) {
        payment.invoiceID = $scope.send.invoiceId;
      }

      $network.api.preparePayment(
        $id.account, payment, Tx.Instructions).then(prepared => {
          return $network.submitTx(prepared, $scope.send.secret,
            $scope.onTransactionSuccess, $scope.onTransactionError,
            $scope.onTransactionSubmit);
      }).catch(console.error);

      $scope.confirmedTime = new Date();
    };

    /**
     * N5. Sent page
     */
    $scope.sent = function (hash) {
      $scope.mode = "status";
      $network.api.connection.on('transaction', handleAccountEvent);

      function handleAccountEvent(e) {
        $scope.$apply(function () {
          if (e.transaction.hash === hash) {
            $scope.setEngineStatus(e, true);
            $network.api.connection.removeListener('transaction', handleAccountEvent);
          }
        });
      }
    };

    $scope.setEngineStatus = function(res, accepted) {
      $scope.engine_result = res.engine_result;
      $scope.engine_result_message = res.engine_result_message;
      $scope.engine_status_accepted = !!accepted;
      $scope.mode = "status";
      $scope.tx_result = "partial";
      switch (res.engine_result.slice(0, 3)) {
        case 'tes':
          $scope.mode = "status";
          $scope.tx_result = accepted ? "cleared" : "pending";
          break;
        case 'tep':
          $scope.mode = "status";
          $scope.tx_result = "partial";
          break;
        default:
          $scope.mode = "rippleerror";
      }
    };

    $scope.saveAddress = function() {
      $scope.addressSaving = true;

      var contact = {
        name: $scope.saveAddressName,
        view: $scope.send.recipient,
        address: $scope.send.recipient_address
      };

      $scope.userBlob.unshift('/contacts', contact, function(err, data) {
        $scope.$apply(function() {
          $scope.addressSaving = false;
          if (err) {
            console.log("Can't save the contact. ", err);
            return;
          }
          $scope.contact = data;
          $scope.addressSaved = true;
          console.log('Saved address!');
        });
      });
    };

    $scope.$on("$destroy", function() {
      // Stop pathfinding if the user leaves the tab
      $network.api.request('path_find', {subcommand: 'close'}).catch(error => {});
    });

    $scope.reset();

    if($routeParams.to && $routeParams.amount) {
      var amountValue = $routeParams.amount;
      if (amountValue === ("" + parseInt(amountValue, 10))) {
        amountValue = amountValue + '.0';
      }
      var amount = deprecated.Amount.from_json(amountValue);
      var currency = amount.currency();
      if ($scope.currencies_all_keyed[currency.get_iso()]) {
        $scope.send.currency_choices = [currency.to_human({full_name:$scope.currencies_all_keyed[currency.get_iso()].name})];
      } else {
        $scope.send.currency_choices = [currency.to_human()];
      }
      $scope.update_destination();
    }
  }]);

  /**
   * Contact name and address uniqueness validator
   */
  // TODO move to global directives
  module.directive('unique', function() {
    return {
      restrict: 'A',
      require: '?ngModel',
      link: function ($scope, elm, attr, ctrl) {
        if (!ctrl) return;

        var validator = function(value) {
          var unique = !webutil.getContact($scope.userBlob.data.contacts,value);
          ctrl.$setValidity('unique', unique);
          if (unique) return value;
        };

        ctrl.$formatters.push(validator);
        ctrl.$parsers.unshift(validator);

        attr.$observe('unique', function() {
          validator(ctrl.$viewValue);
        });
      }
    };
  });
};

module.exports = SendTab;
