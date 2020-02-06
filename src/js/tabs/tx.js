var util = require('util');
var Tab = require('../client/tab').Tab;
var rewriter = require('../util/jsonrewriter');

var TxTab = function ()
{
  Tab.call(this);
};

util.inherits(TxTab, Tab);

TxTab.prototype.tabName = 'tx';

TxTab.prototype.generateHtml = function ()
{
  return require('../../templates/tabs/tx.jade')();
};

TxTab.prototype.angular = function (module)
{
  module.controller('TxCtrl', ['$scope', 'rpNetwork', '$routeParams', 'rpId', '$location',
                               function ($scope, $network, $routeParams, $id, $location)
  {
    $scope.logoutTx = function () {
      $id.logout();
      $location.path('/login');
    };

    if (!$id.loginStatus) return $scope.logoutTx();

    $scope.state = 'loading';
    $scope.transaction = {
      hash: $routeParams.id
    };

    function loadTx() {
      $network.api.request('tx', {
        transaction: $routeParams.id,
        binary: false
      }).then(response =>  {
        $scope.$apply(function () {
          $scope.state = 'loaded';
          _.assign($scope.transaction, response)
          $scope.amountSent = rewriter.getAmountSent(response, response.meta);
        });
      }).catch(function(error) {
        $scope.$apply(function () {
          $scope.state = 'error';
          console.log("Error request 'tx': ", error);
        });
      });
    }

    if ($network.connected) loadTx();
    else var removeListener = $scope.$on('$netConnected', function () {
      removeListener();
      loadTx();
    });
  }]);
};

module.exports = TxTab;
