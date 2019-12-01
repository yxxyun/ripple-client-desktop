/**
 * APP
 *
 * The app controller manages the global scope.
 */

var rewriter = require('../util/jsonrewriter'),
  genericUtils = require('../util/generic'),
  RippleAddress = require('../util/types').RippleAddress,
  fs = require('fs');

var module = angular.module('app', []);

module.controller('AppCtrl', ['$rootScope', '$compile', 'rpId', 'rpNetwork',
                              'rpKeychain', '$route', '$timeout', 'rpFileDialog',
                              function ($scope, $compile, $id, $network,
                                        keychain, $route, $timeout, fileDialog)
{
  reset();

  var account;

  // Global sequence variable to be incremented after every transaction
  $scope.$watch('userBlob', function() {
    if ($scope.userBlob.data && $scope.userCredentials.username) {
      if (!$scope.userBlob.data.sequence) {
        $scope.userBlob.set('/sequence', 1);
      }
      if (!$scope.userBlob.data.fee) {
        $scope.userBlob.set('/fee', 200000);
      }
      if (!$scope.userBlob.data.defaultDirectory) {
        $scope.userBlob.set('/defaultDirectory', '');
      }
      $scope.sequence = $scope.userBlob.data.sequence;
      $scope.fee = $scope.userBlob.data.fee;
      $scope.defaultDirectory = $scope.userBlob.data.defaultDirectory;
    }
  });

  $scope.incrementSequence = function() {
    $scope.sequence++;
    $scope.userBlob.set('/sequence', $scope.sequence);
  }

  // TODO make this wallet specific
  $scope.onlineMode = !!store.get('onlineMode');

  // Remember the onlineMode switch value and handle the connection
  $scope.switchOnlineMode = function(){
    $scope.onlineMode = !$scope.onlineMode;
    $scope.onlineMode ? $network.connect() : $network.disconnect();
    store.set('onlineMode', $scope.onlineMode);
  };

  // For announcement banner
  $scope.showAnnouncement = store.get('announcement');

  if('undefined' === typeof $scope.showAnnouncement) $scope.showAnnouncement = true;

  $scope.dismissBanner = function() {
    store.set('announcement', false);
    $scope.showAnnouncement = store.get('announcement');
  }

  // Set default directory if it has not already been set
  $scope.fileInputClick = function(txnName, txData) {
    fileDialog.openDir(function(evt) {
      $scope.$apply(function() {
        $scope.defaultDirectory = evt;
        $scope.$watch('userBlob', function() {
          if ($scope.userBlob.data && $scope.userCredentials.username) {
            $scope.userBlob.set('/defaultDirectory', evt);
            if ($scope.defaultDirectory) {
              $scope.saveToDisk(txnName, txData);
            }
          }
        });
      });
    });
  };

  $scope.saveToDisk = function(txnName, txData) {
    var fileName = $scope.userBlob.data.defaultDirectory + '/' + txnName;
    fs.writeFile(fileName, txData, function(err) {
      $scope.$apply(function() {
        $scope.fileName = fileName;
        if (err) {
          console.log('Error saving transaction: ', JSON.stringify(err));
          $scope.error = true;
        } else {
          console.log('saved file');
          $scope.saved = true;
        }
      });
      // Reset root scope vars so messages do not persist accross controllers
      setTimeout(function() {
        $scope.error = $scope.saved = undefined;
      }, 1000);
    });
  };

  // Global reference for debugging only (!)
  if ("object" === typeof rippleclient) {
    rippleclient.id = $id;
    rippleclient.network = $network;
    rippleclient.keychain = keychain;
  }

  function reset()
  {
    $scope.defaultDirectory = '';
    $scope.account = {};
    $scope.lines = {};
    $scope.offers = {};
    $scope.events = [];
    $scope.history = [];
    $scope.balances = {};
    $scope.loadState = [];
    $scope.unseenNotifications = {
      count: 0
    };
  }

  // Load notification modal
  $scope.load_notification = function(status) {
    if (typeof status !== 'string') {
      console.log("You must pass in a string for the status");
      return;
    }

    $scope.notif = status;

    $timeout(function() {
      $scope.notif = "clear";
    }, 7000);
  }

  // TODO fix this
  $scope.reset = function(){
    reset();
  }

  function handleAccountLoad(e, data)
  {
    // If user logs in with regular key wallet
    // check to see if wallet is still valid
    $network.api.getSettings(data.account).then(settings => {
      $scope.$apply(function() {
        var invalidRegularWallet = false;
        if ($scope.userBlob.data.regularKey && !$scope.userBlob.data.masterkey) {
          // If we are using a regular wallet file (no masterkey)
          // check to see if regular key is valid
          var regularKeyPublic = new RippleAddress($scope.userBlob.data.regularKey).getAddress();
          if (regularKeyPublic !== settings.regularKey) {
            invalidRegularWallet = true;
          }
        }
        $scope.invalidRegularWallet = invalidRegularWallet;
      });
    }).catch(function(error) {
        console.log('Error getSettings: ', error);
    });

    account = data.account;

    reset();

    $scope.loadingAccount = true;
    $scope.subscribedAccount = false;

    $network.api.connection.on('transaction', handleAccountEvent);
    $network.api.connection.on('transaction', response => {
      var accountRoot = {};
      response.meta.AffectedNodes.forEach(function(node) {
        if (!node.ModifiedNode) return;
        if (node.ModifiedNode.LedgerEntryType === 'AccountRoot' &&
            node.ModifiedNode.FinalFields &&
            node.ModifiedNode.FinalFields.Account === data.account) {
          accountRoot = $.extend({}, node.ModifiedNode.FinalFields);
        }
      })
      if (!$.isEmptyObject(accountRoot)) {
        $scope.$apply(function () {
          $scope.loadingAccount = false;
          handleAccountEntry(accountRoot);
        });
      }
    });

    $network.api.request('account_info', {
      account: data.account,
      ledger_index: 'validated'
    }).then(response => {
      $scope.loadingAccount = false;
      handleAccountEntry(response.account_data)
    }).catch(function(error) {
      console.log('Error getAccountInfo: ', error);
      $scope.$apply(function () {
        $scope.loadingAccount = false;
        $scope.loadState['account'] = true;
      });
    });

    $network.api.request('subscribe', {
      accounts: [ data.account ]
    }).then(response => {
      console.log('Subscribed to account "', data.account, '"');
      $scope.$apply(function () {
        $scope.subscribedAccount = true;
      });
    }).catch(function(error) {
      console.log('Error subscribe to account "', data.account, '": ', error);
    });

    // Ripple credit lines
    $network.api.request('account_lines', {account: data.account})
      .then(handleRippleLines)
      .catch(handleRippleLinesError);

    // Transactions
    $network.api.request('account_tx', {
      account: data.account,
      ledger_index_min: -1,
      forward: false,
      limit: Options.transactions_per_page,
      binary: false
    }).then(handleAccountTx)
      .catch(handleAccountTxError);

    // Outstanding offers
    $network.api.request('account_offers', {account: data.account})
      .then(handleOffers)
      .catch(handleOffersError);
  }

  function handleAccountUnload(e, data)
  {
    if ($scope.subscribedAccount) {
      $network.api.request('unsubscribe', {
        accounts: [ data.account ]
      }).then(response => {
        console.log('Unsubscribed to account "', data.account, '"');
        $scope.$apply(function () {
          $scope.subscribedAccount = false;
        });
      }).catch(function(error) {
        console.log('Error unsubscribe to account "', data.account, '": ',
                    error);
      });
    }
  }

  function handleRippleLines(data)
  {
    $scope.$apply(function () {
      $scope.lines = {};

      for (var n=0, l=data.lines.length; n<l; n++) {
        var line = data.lines[n];

        // XXX: This reinterpretation of the server response should be in the
        //      library upstream.
        line = $.extend({}, line, {
          limit: deprecated.Amount.from_json({value: line.limit, currency: line.currency, issuer: line.account}),
          limit_peer: deprecated.Amount.from_json({value: line.limit_peer, currency: line.currency, issuer: line.account}),
          balance: deprecated.Amount.from_json({value: line.balance, currency: line.currency, issuer: line.account})
        });

        $scope.lines[line.account+line.currency] = line;
        updateRippleBalance(line.currency, line.account, line.balance);
      }
      console.log('lines updated:', $scope.lines);

      $scope.$broadcast('$balancesUpdate');

      $scope.loadState['lines'] = true;
    });
  }

  function handleRippleLinesError(data)
  {
    $scope.$apply(function () {
      $scope.loadState['lines'] = true;
    });
  }

  function handleOffers(data)
  {
    $scope.$apply(function () {
      data.offers.forEach(function (offerData) {
        var offer = {
          seq: +offerData.seq,
          gets: deprecated.Amount.from_json(offerData.taker_gets),
          pays: deprecated.Amount.from_json(offerData.taker_pays),
          flags: offerData.flags
        };

        updateOffer(offer);
      });
      console.log('offers updated:', $scope.offers);
      $scope.$broadcast('$offersUpdate');

      $scope.loadState['offers'] = true;
    });
  }

  function handleOffersError(data)
  {
    $scope.$apply(function () {
      $scope.loadState['offers'] = true;
    });
  }

  function reserve(serverInfo, OwnerCount) {
    return Number(serverInfo.validatedLedger.reserveBaseXRP) +
        Number(serverInfo.validatedLedger.reserveIncrementXRP) * OwnerCount;
  }

  function handleAccountEntry(data)
  {
    // Only overwrite account data if the new data has a bigger sequence number
    // (is a newer information)
    if ($scope.account && $scope.account.Sequence &&
        $scope.account.Sequence >= data.Sequence) {
      return;
    }

    $network.api.getServerInfo().then(serverInfo => {
      $scope.$apply(() => {
        var OwnerCount = data.OwnerCount || 0;
        data.Balance = Number(data.Balance) / 1000000;
        data.reserve_base = reserve(serverInfo, 0);
        data.reserve = reserve(serverInfo, OwnerCount);
        data.reserve_to_add_trust = reserve(serverInfo, OwnerCount+1);
        data.reserve_low_balance = data.reserve * 2;

        // Maximum amount user can spend
        data.max_spend = data.Balance - data.reserve;

        $scope.account = data;
        $scope.loadState['account'] = true;
      });
    }).catch(error => {
      console.log('Error getServerInfo: ', error);
    });
  }

  function handleAccountTx(data){
    $scope.$apply(function () {
      $scope.tx_marker = data.marker;

      if (data.transactions) {
        data.transactions.reverse().forEach(function (e, key) {
          processTxn($network.api, e.tx, e.meta, true);
        });

        $scope.$broadcast('$eventsUpdate');
      }

      $scope.loadState['transactions'] = true;
    });
  }

  function handleAccountTxError(data)
  {
    $scope.$apply(function () {
      $scope.loadState['transactions'] = true;
    });
  }

  function handleAccountEvent(e)
  {
    $scope.$apply(function () {
      processTxn($network.api, e.transaction, e.meta);
      $scope.$broadcast('$eventsUpdate');
    });
  }

  /**
   * Process a transaction and add it to the history table.
   */
  function processTxn(api, tx, meta, is_historic)
  {
    var processedTxn = rewriter.processTxn(api, tx, meta, account);

    if (processedTxn && processedTxn.error) {
      var err = processedTxn.error;
      console.error('Error processing transaction '+processedTxn.transaction.hash+'\n',
                    err && 'object' === typeof err && err.stack ? err.stack : err);

      // Add to history only
      $scope.history.unshift(processedTxn);
    } else if (processedTxn) {
      var transaction = processedTxn.transaction;

      // Show status notification
      if (processedTxn.tx_result === "tesSUCCESS" &&
          transaction &&
          !is_historic) {

        $scope.$broadcast('$appTxNotification', {
          hash:tx.hash,
          tx: transaction
        });
      }

      // Add to recent notifications
      if (processedTxn.tx_result === "tesSUCCESS" &&
          transaction) {

        var effects = [];
        // Only show specific transactions
        switch (transaction.type) {
          case 'offernew':
          case 'exchange':
            var funded = false;
            processedTxn.effects.some(function(effect) {
              if (_.includes(['offer_bought','offer_funded','offer_partially_funded'], effect.type)) {
                funded = true;
                effects.push(effect);
                return true;
              }
            });

            // Only show trades/exchanges which are at least partially funded
            if (!funded) {
              break;
            }
            /* falls through */
          case 'received':

            // Is it unseen?
            if (processedTxn.date > ($scope.userBlob.data.lastSeenTxDate || 0)) {
              processedTxn.unseen = true;
              $scope.unseenNotifications.count++;
            }

            processedTxn.showEffects = effects;
            $scope.events.unshift(processedTxn);
        }
      }

      // Add to history
      $scope.history.unshift(processedTxn);

      // Update Ripple lines
      if (processedTxn.effects && !is_historic) {
        updateLines(processedTxn.effects);
      }

      // Update my offers
      if (processedTxn.effects && !is_historic) {
        // Iterate on each effect to find offers
        processedTxn.effects.forEach(function (effect) {
          // Only these types are offers
          if (_.includes([
            'offer_created',
            'offer_funded',
            'offer_partially_funded',
            'offer_cancelled'], effect.type))
          {
            var offer = {
              seq: +effect.seq,
              gets: effect.gets,
              pays: effect.pays,
              deleted: effect.deleted,
              flags: effect.flags
            };

            updateOffer(offer);
          }
        });

        $scope.$broadcast('$offersUpdate');
      }
    }
  }

  function updateOffer(offer)
  {
    if (offer.flags && offer.flags === deprecated.Remote.flags.offer.Sell) {
      offer.type = 'sell';
      offer.first = offer.gets;
      offer.second = offer.pays;
    } else {
      offer.type = 'buy';
      offer.first = offer.pays;
      offer.second = offer.gets;
    }

    if (!offer.deleted) {
      $scope.offers[""+offer.seq] = offer;
    } else {
      delete $scope.offers[""+offer.seq];
    }
  }

  function updateLines(effects)
  {
    if (!$.isArray(effects)) return;

    var balancesUpdated;

    effects.forEach(function (effect) {
      if (_.includes([
        'trust_create_local',
        'trust_create_remote',
        'trust_change_local',
        'trust_change_remote',
        'trust_change_balance',
        'trust_change_flags'], effect.type))
      {
        var line = {},
            index = effect.counterparty + effect.currency;

        line.currency = effect.currency;
        line.account = effect.counterparty;
        line.flags = effect.flags;
        line.no_ripple = !!effect.noRipple; // Force Boolean
        line.freeze = !!effect.freeze; // Force Boolean
        line.authorized = !!effect.auth;

        if (effect.balance) {
          line.balance = effect.balance;
          updateRippleBalance(effect.currency, effect.counterparty, effect.balance);
          balancesUpdated = true;
        }

        if (effect.deleted) {
          delete $scope.lines[index];
          return;
        }

        if (effect.limit) {
          line.limit = effect.limit;
        }

        if (effect.limit_peer) {
          line.limit_peer = effect.limit_peer;
        }

        $scope.lines[index] = $.extend($scope.lines[index], line);
      }
    });

    if (balancesUpdated) $scope.$broadcast('$balancesUpdate');
  }

  function updateRippleBalance(currency, new_account, new_balance)
  {
    // Ensure the balances entry exists first
    if (!$scope.balances[currency]) {
      $scope.balances[currency] = {components: {}, total: null};
    }

    var balance = $scope.balances[currency];

    if (new_account) {
      balance.components[new_account] = new_balance;
    }

    $(balance.components).sort(function(a,b){
      return a.compareTo(b);
    });

    balance.total = null;
    for (var counterparty in balance.components) {
      var amount = balance.components[counterparty];
      balance.total = balance.total ? balance.total.add(amount) : amount;
    }
  }

  $scope.currencies_all = require('../data/currencies');

  // prefer currency full_names over whatever the local storage has saved
  var storeCurrenciesAll = store.get('ripple_currencies_all') || [];

  // run through all currencies
  _.forEach($scope.currencies_all, function(currency) {

    // find the currency in the local storage
    var allCurrencyHit = _.filter(storeCurrenciesAll, {value: currency.value})[0];

    // if the currency already exists in local storage, updated only the name
    if (allCurrencyHit) {
      allCurrencyHit.name = currency.name;
    } else {
      // else append the currency to the storeCurrenciesAll array
      storeCurrenciesAll.push(currency);
    }
  });

  $scope.currencies_all = storeCurrenciesAll;

  // Personalized default pair set
  if (!store.disabled && !store.get('ripple_pairs_all')) {
    store.set('ripple_pairs_all',require('../data/pairs'));
  }

  var pairs_all = store.get('ripple_pairs_all');
  var pairs_default = require('../data/pairs');
  $scope.pairs_all = genericUtils.uniqueObjArray(pairs_all, pairs_default, 'name');

  function compare(a, b) {
    if (a.order < b.order) return 1;
    if (a.order > b.order) return -1;
    return 0;
  }

  // sort currencies and pairs by order
  $scope.currencies_all.sort(compare);

  function compare_last_used(a, b) {
    var time_a = a.last_used || a.order || 0;
    var time_b = b.last_used || b.order || 0;
    if (time_a < time_b) return 1;
    if (time_a > time_b) return -1;
    return 0;
  }
  $scope.pairs_all.sort(compare_last_used);

  $scope.currencies_all_keyed = {};
  _.forEach($scope.currencies_all, function(currency){
    $scope.currencies_all_keyed[currency.value] = currency;
  });

  $scope.$watch('currencies_all', function(){
    if (!store.disabled) {
      store.set('ripple_currencies_all',$scope.currencies_all);
    }
  }, true);

  $scope.$watch('pairs_all', function(){
    if (!store.disabled) {
      store.set('ripple_pairs_all',$scope.pairs_all);
    }
  }, true);

  $scope.pairs = $scope.pairs_all.slice(1);

  $scope.app_loaded = 'loaded';

  // Moved this to the run block
  // Nav links same page click fix
  // $('nav a').click(function(){
  //   if (location.hash == this.hash) {
  //     location.href="#/";
  //     location.href=this.href;
  //   }
  // });

  $scope.$on('$netConnected', function() {
    var address = $scope.address;

    if (address) {
      $id.setAccount(address);
    }
  });

  $scope.$on('$idAccountLoad', function (e, data) {
    // fix blob if wrong
    if (_.isArray($scope.userBlob.data.clients)) {
      $scope.userBlob.unset('/clients');
    }

    // Server is connected
    if ($scope.connected) {
      handleAccountLoad(e, data);
    }
  });

  $scope.$on('$idAccountUnload', handleAccountUnload);

  // XXX: The app also needs to handle updating its data when the connection is
  //      lost and later re-established. (... or will the Ripple lib do that for us?)
  var removeFirstConnectionListener =
        $scope.$on('$netConnected', handleFirstConnection);
  function handleFirstConnection() {
    removeFirstConnectionListener();
  }

  $network.listenId($id);
  $id.init();

  $scope.onlineMode ? $network.connect() : $network.disconnect();

  // Reconnect on server setting changes
  $scope.$on('serverChange', function(event) {
    if ($scope.onlineMode) {
      $network.disconnect();
      $network.connect();
    }
  });

  $scope.logout = function () {
    $id.logout();
    $route.reload();
  };

  $scope.$on('$idRemoteLogout', handleRemoteLogout);
  function handleRemoteLogout()
  {
    $route.reload();
  }

  // Generate an array of source currencies for path finding.
  // This will generate currencies for every issuers.
  // It will also generate a self-issue currency for currencies which have multi issuers.
  //
  // Example balances for account rEXAMPLE:
  //   CNY: rCNY1
  //        rCNY2
  //   BTC: rBTC
  // Will generate:
  //   CNY/rEXAMPLE
  //   CNY/rCNY1
  //   CNY/rCNY2
  //   BTC/rBTC
  $scope.generate_src_currencies = function () {
    var src_currencies = [];
    var balances = $scope.balances;
    var isIssuer = $scope.generate_issuer_currencies();
    src_currencies.push({ currency: "XRP" });
    for (var currency_name in balances) {
      if (!balances.hasOwnProperty(currency_name)) continue;

      var currency = balances[currency_name];
      var currency_hex = currency.total.currency().to_hex();
      var result = [];
      for (var issuer_name in currency.components)
      {
        if (!currency.components.hasOwnProperty(issuer_name)) continue;
        var component = currency.components[issuer_name];
        if (component.is_positive())
          result.push({ currency: currency_hex, issuer: issuer_name});
      }

      if (result.length > 1 || isIssuer[currency_hex] || result.length === 0)
        result.unshift({ currency: currency_hex });

      src_currencies = src_currencies.concat(result);
    }
    return src_currencies;
  };

  $scope.generate_issuer_currencies = function () {
    var isIssuer = {};
    _.forEach($scope.lines, function(line){
      if (line.limit_peer.is_positive()) {
        isIssuer[line.balance.currency().to_hex()] = true;
      }
    });
    return isIssuer;
  };




  /**
   * Testing hooks
   */
  this.reset                  =  reset;
  this.handleAccountLoad      =  handleAccountLoad;
  this.handleAccountUnload    =  handleAccountUnload;
  this.handleRemoteLogout     =  handleRemoteLogout;
  this.handleRippleLines      =  handleRippleLines;
  this.handleRippleLinesError =  handleRippleLinesError;
  this.handleOffers           =  handleOffers;
  this.handleOffersError      =  handleOffersError;
  this.handleAccountEntry     =  handleAccountEntry;
  this.handleAccountTx        =  handleAccountTx;
  this.handleAccountTxError   =  handleAccountTxError;
  this.handleAccountEvent     =  handleAccountEvent;
  this.processTxn             =  processTxn;
  this.updateOffer            =  updateOffer;
  this.updateLines            =  updateLines;
  this.updateRippleBalance    =  updateRippleBalance;
  this.compare                =  compare;
  this.handleFirstConnection  =  handleFirstConnection;
}]);
