/**
 * BOOKS
 *
 * The books service is used to keep track of orderbooks.
 */

var module = angular.module('books', ['network']);


module.factory('rpBooks', ['rpNetwork', '$q', '$rootScope', '$filter', 'rpId',
                           function($network, $q, $scope, $filter, $id) {

  var rowCount;

  function loadBook(gets, pays) {
    return new OrderBook.createOrderBook($network.apiOrderbook, {
      currency_gets: gets.currency,
      issuer_gets: gets.issuer,
      currency_pays: pays.currency,
      issuer_pays: pays.issuer
    });
  }

  function filterRedundantPrices(data, action, combine) {
    var max_rows = Options.orderbook_max_rows || 100;

    var lastprice;
    var current;
    var rpamount = $filter('rpamount');
    var newData = $.extend(true, {}, data);

    rowCount = 0;
    newData = _.values(_.compact(_.map(newData, function(d, i) {

      // This check is redundant, but saves the CPU some work
      if (rowCount > max_rows) {
        return false;
      }

      // rippled has a bug where it shows some unfunded offers
      // We're ignoring them
      if (d.taker_gets_funded === '0' || d.taker_pays_funded === '0') {
        return false;
      }

      d.TakerGetsFunded = d.TakerGets;
      d.TakerPaysFunded = d.TakerPays;

      if (d.TakerGetsFunded.value) {
        d.TakerGetsFunded.value = d.taker_gets_funded;
      } else {
        d.TakerGetsFunded = parseInt(Number(d.taker_gets_funded), 10);
      }

      if (d.TakerPaysFunded.value) {
        d.TakerPaysFunded.value = d.taker_pays_funded;
      } else {
        d.TakerPaysFunded = parseInt(Number(d.taker_pays_funded), 10);
      }

      d.TakerGetsFunded = deprecated.Amount.from_json(d.TakerGetsFunded);
      d.TakerPaysFunded = deprecated.Amount.from_json(d.TakerPaysFunded);

      // You never know
      if (!d.TakerGetsFunded.is_valid() || !d.TakerPaysFunded.is_valid()) {
        return false;
      }

      if (action === 'asks') {
        d.price = deprecated.Amount.from_quality(d.BookDirectory, d.TakerPaysFunded.currency(),
          d.TakerPaysFunded.issuer(), {
            base_currency: d.TakerGetsFunded.currency(),
            reference_date: new Date()
          });
      } else {
        d.price = deprecated.Amount.from_quality(d.BookDirectory, d.TakerGetsFunded.currency(),
          d.TakerGetsFunded.issuer(), {
            inverse: true,
            base_currency: d.TakerPaysFunded.currency(),
            reference_date: new Date()
          });
      }

      var price = rpamount(d.price, {
        rel_precision: 4,
        rel_min_precision: 2
      });

      // Don't combine current user's orders.
      if (d.Account === $id.account) {
        d.my = true;
      }

      if (lastprice === price && !d.my && !newData[current].my && combine) {
        newData[current].TakerPaysFunded = deprecated.Amount.from_json(newData[current].TakerPaysFunded).add(d.TakerPaysFunded);
        newData[current].TakerGetsFunded = deprecated.Amount.from_json(newData[current].TakerGetsFunded).add(d.TakerGetsFunded);
        newData[current].Account = newData[current].Account + "\n" + d.Account
        d = false;
      } else {
        current = i;
        lastprice = price;
        rowCount++;
        if (rowCount > max_rows) {
          return false;
        }
      }

      return d;
    })));

    var key = action === 'asks' ? 'TakerGetsFunded' : 'TakerPaysFunded';
    var sum;
    _.forEach(newData, function (order) {
      if (sum) {
        sum = order.sum = sum.add(order[key]);
      } else {
        sum = order.sum = order[key];
      }
    });

    return newData;
  }

  return {
    get: function(first, second) {
      var asks = loadBook(first, second);
      var bids = loadBook(second, first);

      var model = {
        asks: filterRedundantPrices(asks.getOffersSync(), 'asks', true),
        bids: filterRedundantPrices(bids.getOffersSync(), 'bids', true)
      };

      function handleAskModel(offers) {
        $scope.$apply(function () {
          model.asks = filterRedundantPrices(offers, 'asks', true);
          model.updated = true;
        });
      }

      function normalize(value) {
        if (value instanceof XRPValue) {
          // The XRPValue returns from orderbook trade event is in drops.
          // Turning it into IOUValue is a necessary hack because if XRPValue is
          // divisor, it will become drops again during division as defined in
          // ripple-lib-value.
          return new IOUValue($network.apiOrderbook.dropsToXrp(value._value));
        }
        return value
      }

      function handleAskTrade(gets, pays) {
        $scope.$apply(function () {
          model.last_price = new deprecated.Amount(
            normalize(gets).divide(normalize(pays)));
          model.updated = true;
        });
      }
      asks.on('model', handleAskModel);
      asks.on('trade', handleAskTrade);

      function handleBidModel(offers) {
        $scope.$apply(function () {
          model.bids = filterRedundantPrices(offers, 'bids', true);
          model.updated = true;
        });
      }

      function handleBidTrade(gets, pays) {
        $scope.$apply(function () {
          model.last_price = new deprecated.Amount(
            normalize(pays).divide(normalize(gets)));
          model.updated = true;
        });
      }
      bids.on('model', handleBidModel);
      bids.on('trade', handleBidTrade);

      model.unsubscribe = function() {
        asks.removeListener('model', handleAskModel);
        asks.removeListener('trade', handleAskTrade);
        bids.removeListener('model', handleBidModel);
        bids.removeListener('trade', handleBidTrade);
      };

      return model;
    },

    getLength: function() {
      return rowCount;
    }
  };
}]);
