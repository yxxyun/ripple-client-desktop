/**
 * Ripple API
 *
 * The PairsQueryUtils service
 */

'use strict';

var gateways = require('../../../deps/gateways.json');

var module = angular.module('pairsqueryutils', []);

module.factory(
	'pairsQueryUtils',

	function(){

		var gatewayNameByAddress = {};

		gateways.map(function(gw){
			gatewayNameByAddress[gw['accounts'][0]['address']] = gw['name'];
		});

		var getGatewayNameByAddress = function(address){
			return gatewayNameByAddress[address] || address;
		};


		var replaceAddressesByLabels = function(addressesText){

			for(var item in gatewayNameByAddress){

				var regxep = new RegExp(item);

				addressesText = addressesText
					.replace(regxep, gatewayNameByAddress[item]);

			}

			addressesText = addressesText.replace(/\./g, ' ').replace(/\//g, ' / ');

			return addressesText;

		};

		var replaceKeyAddressByGatewayName = function(items){
			for(var item in items){
				items[item]['label'] = getGatewayNameByAddress(item) || items[item]['name'];
			}
		};

		return {
			replaceAddressesByLabels: replaceAddressesByLabels,
			replaceKeyAddressByGatewayName: replaceKeyAddressByGatewayName,
			getGatewayNameByAddress: getGatewayNameByAddress
		};

	}
);