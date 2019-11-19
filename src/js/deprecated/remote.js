'use strict';

var Remote = {};

// Flags for ledger entries. In support of accountRoot().
Remote.flags = {
  // AccountRoot
  account_root: {
    PasswordSpent: 0x00010000, // password set fee is spent
    RequireDestTag: 0x00020000, // require a DestinationTag for payments
    RequireAuth: 0x00040000, // require a authorization to hold IOUs
    DisallowXRP: 0x00080000, // disallow sending XRP
    DisableMaster: 0x00100000,  // force regular key
    NoFreeze: 0x00200000, // permanently disallowed freezing trustlines
    GlobalFreeze: 0x00400000, // trustlines globally frozen
    DefaultRipple: 0x00800000
  },
  // Offer
  offer: {
    Passive: 0x00010000,
    Sell: 0x00020000  // offer was placed as a sell
  },
  // Ripple state
  state: {
    LowReserve: 0x00010000, // entry counts toward reserve
    HighReserve: 0x00020000,
    LowAuth: 0x00040000,
    HighAuth: 0x00080000,
    LowNoRipple: 0x00100000,
    HighNoRipple: 0x00200000,
    LowFreeze: 0x00400000,
    HighFreeze: 0x00800000
  }
};

exports.Remote = Remote;

// vim:sw=2:sts=2:ts=8:et
