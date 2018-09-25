require('dotenv').config();
const logger = require('./logger')('eventsStats');
const Web3 = require('web3');
const { decodeBridgeMode, BRIDGE_MODES } = require('./utils/bridgeMode')
const HOME_RPC_URL = process.env.HOME_RPC_URL;
const FOREIGN_RPC_URL = process.env.FOREIGN_RPC_URL;
const HOME_BRIDGE_ADDRESS = process.env.HOME_BRIDGE_ADDRESS;
const FOREIGN_BRIDGE_ADDRESS = process.env.FOREIGN_BRIDGE_ADDRESS;
const POA20_ADDRESS = process.env.POA20_ADDRESS;
const HOME_DEPLOYMENT_BLOCK = Number(process.env.HOME_DEPLOYMENT_BLOCK) || 0;
const FOREIGN_DEPLOYMENT_BLOCK = Number(process.env.FOREIGN_DEPLOYMENT_BLOCK) || 0;

const homeProvider = new Web3.providers.HttpProvider(HOME_RPC_URL);
const web3Home = new Web3(homeProvider);

const foreignProvider = new Web3.providers.HttpProvider(FOREIGN_RPC_URL);
const web3Foreign = new Web3(foreignProvider);

const HOME_NATIVE_ABI = require('./abis/HomeBridgeNativeToErc.abi')
const FOREIGN_NATIVE_ABI = require('./abis/ForeignBridgeNativeToErc.abi')
const HOME_ERC_ABI = require('./abis/HomeBridgeErcToErc.abi')
const FOREIGN_ERC_ABI = require('./abis/ForeignBridgeErcToErc.abi')
const ERC20_ABI = require('./abis/ERC20.abi')

function compareDepositsHome(foreign){
  return function(homeDeposit){
    return foreign.filter(function(foreignDeposit){
      return foreignDeposit.returnValues.transactionHash === homeDeposit.transactionHash
           && foreignDeposit.returnValues.recipient === homeDeposit.returnValues.recipient && 
           foreignDeposit.returnValues.value === homeDeposit.returnValues.value
    }).length === 0;
  }
}
function compareDepositsForeign(home){
  return function(foreignDeposit){
    return home.filter(function(homeDeposit){
      return homeDeposit.transactionHash === foreignDeposit.returnValues.transactionHash
           && homeDeposit.returnValues.recipient === foreignDeposit.returnValues.recipient && 
           homeDeposit.returnValues.value === foreignDeposit.returnValues.value
    }).length === 0;
  }
}

function compareTransferHome(foreign){
  return function(homeDeposit){
    return foreign.filter(function(foreignDeposit){
      return homeDeposit.returnValues.transactionHash === foreignDeposit.transactionHash
        && homeDeposit.returnValues.recipient === foreignDeposit.returnValues.from &&
        homeDeposit.returnValues.value === foreignDeposit.returnValues.value
    }).length === 0;
  }
}
function compareTransferForeign(home){
  return function(foreignDeposit){
    return home.filter(function(homeDeposit){
      return foreignDeposit.transactionHash === homeDeposit.returnValues.transactionHash
        && foreignDeposit.returnValues.from === homeDeposit.returnValues.recipient &&
        foreignDeposit.returnValues.value === homeDeposit.returnValues.value
    }).length === 0;
  }
}

async function main(){
  try {
    const homeErcBridge = new web3Home.eth.Contract(HOME_ERC_ABI, HOME_BRIDGE_ADDRESS)
    const bridgeModeHash = await homeErcBridge.methods.getBridgeMode().call()
    const bridgeMode = decodeBridgeMode(bridgeModeHash)
    const isErcToErcMode = bridgeMode === BRIDGE_MODES.ERC_TO_ERC_MODE
    logger.debug("isErcToErcMode", isErcToErcMode)
    const HOME_ABI = isErcToErcMode ? HOME_ERC_ABI : HOME_NATIVE_ABI
    const FOREIGN_ABI = isErcToErcMode ? FOREIGN_ERC_ABI : FOREIGN_NATIVE_ABI
    const homeBridge = new web3Home.eth.Contract(HOME_ABI, HOME_BRIDGE_ADDRESS);
    const foreignBridge = new web3Foreign.eth.Contract(FOREIGN_ABI, FOREIGN_BRIDGE_ADDRESS);
    const erc20Contract = new web3Foreign.eth.Contract(ERC20_ABI, POA20_ADDRESS)
    logger.debug("calling homeBridge.getPastEvents('UserRequestForSignature')");
    let homeDeposits = await homeBridge.getPastEvents('UserRequestForSignature', {fromBlock: HOME_DEPLOYMENT_BLOCK});
    logger.debug("calling foreignBridge.getPastEvents('RelayedMessage')");
    let foreignDeposits = await foreignBridge.getPastEvents('RelayedMessage', {fromBlock: FOREIGN_DEPLOYMENT_BLOCK});
    logger.debug("calling homeBridge.getPastEvents('AffirmationCompleted')");
    let homeWithdrawals = await homeBridge.getPastEvents('AffirmationCompleted', {fromBlock: HOME_DEPLOYMENT_BLOCK});
    logger.debug("calling foreignBridge.getPastEvents('UserRequestForAffirmation')");
    let foreignWithdrawals = isErcToErcMode
      ? await erc20Contract.getPastEvents('Transfer', {fromBlock: FOREIGN_DEPLOYMENT_BLOCK, filter: { to: FOREIGN_BRIDGE_ADDRESS }})
      : await foreignBridge.getPastEvents('UserRequestForAffirmation', {fromBlock: FOREIGN_DEPLOYMENT_BLOCK})

    const onlyInHomeDeposits = homeDeposits.filter(compareDepositsHome(foreignDeposits))
    const onlyInForeignDeposits = foreignDeposits.concat([]).filter(compareDepositsForeign(homeDeposits))

    const onlyInHomeWithdrawals = isErcToErcMode
      ? homeWithdrawals.filter(compareTransferHome(foreignWithdrawals))
      : homeWithdrawals.filter(compareDepositsForeign(foreignWithdrawals))
    const onlyInForeignWithdrawals = isErcToErcMode
      ? foreignWithdrawals.filter(compareTransferForeign(homeWithdrawals))
      : foreignWithdrawals.filter(compareDepositsHome(homeWithdrawals))
    
    logger.debug("Done");
    return {
      onlyInHomeDeposits,
      onlyInForeignDeposits,
      onlyInHomeWithdrawals,
      onlyInForeignWithdrawals,
      lastChecked: Math.floor(Date.now() / 1000),
    }
  } catch(e) {
    logger.error(e);
    throw e;
  }

}

module.exports = main;
