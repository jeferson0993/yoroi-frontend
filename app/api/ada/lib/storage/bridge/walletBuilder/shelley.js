// @flow

import { range } from 'lodash';
import {
  lf$Database
} from 'lovefield';
import {
  HARD_DERIVATION_START,
  CARDANO_COINTYPE,
  CIP_1852_PURPOSE,
  BIP44_SCAN_SIZE,
  EXTERNAL,
  INTERNAL,
} from '../../../../../../config/numbersConfig';

import type {
  TreeInsert,
} from '../../database/walletTypes/common/utils';
import type { Bip44ChainInsert } from '../../database/walletTypes/common/tables';

import { WalletBuilder } from './builder';

import { RustModule } from '../../../cardanoCrypto/rustLoader';
import { encryptWithPassword } from '../../../../../../utils/passwordCipher';
import type { AddressDiscriminationType } from 'js-chain-libs';

import {
  Bip44DerivationLevels,
  Bip44TableMap,
} from '../../database/walletTypes/bip44/api/utils';
import type {
  HasConceptualWallet,
  HasCip1852Wrapper,
  HasPublicDeriver,
  HasRoot,
} from './builder';
import type { AddByHashFunc } from '../hashMapper';
import { rawGenAddByHash } from '../hashMapper';
import { addShelleyAddress } from '../../../../restoration/shelley/scan';


// TODO: maybe move this inside walletBuilder somehow so it's all done in the same transaction
/**
 * We generate addresses here instead of relying on scanning functions
 * This is because scanning depends on having an internet connection
 * But we need to ensure the address maintains the BIP44 gap regardless of internet connection
 */
export async function getAccountDefaultDerivations(
  discrimination: AddressDiscriminationType,
  accountPublicKey: RustModule.WalletV3.Bip32PublicKey,
  addByHash: AddByHashFunc,
): Promise<TreeInsert<Bip44ChainInsert>> {
  const addressesIndex = range(
    0,
    BIP44_SCAN_SIZE
  );

  const externalAddrs = addressesIndex.map(i => {
    const key = accountPublicKey
      .derive(EXTERNAL)
      .derive(i)
      .to_raw_key();
    const addr = RustModule.WalletV3.Address.single_from_public_key(
      key,
      discrimination,
    );
    return Buffer.from(addr.as_bytes()).toString('hex');
  });
  const internalAddrs = addressesIndex.map(i => {
    const key = accountPublicKey
      .derive(INTERNAL)
      .derive(i)
      .to_raw_key();
    const addr = RustModule.WalletV3.Address.single_from_public_key(
      key,
      discrimination,
    );
    return Buffer.from(addr.as_bytes()).toString('hex');
  });
  /**
   * Even if the user has no internet connection and scanning fails,
   * we need to initialize our wallets with the bip44 gap size directly
   *
   * Otherwise the generated addresses won't be added to the wallet at all.
   * This would violate our bip44 obligation to maintain a unused address gap
   *
   * Example:
   * If we throw, no new addresses will be added
   * so the user's balance would be stuck at 0 until they reinstall Yoroi.
   */
  const externalAddresses = addressesIndex.map(i => ({
    index: i,
    insert: async insertRequest => {
      return await addShelleyAddress(
        addByHash,
        insertRequest,
        externalAddrs[i]
      );
    },
  }));
  const internalAddresses = addressesIndex.map(i => ({
    index: i,
    insert: async insertRequest => {
      return await addShelleyAddress(
        addByHash,
        insertRequest,
        internalAddrs[i]
      );
    },
  }));

  return [
    {
      index: 0,
      insert: insertRequest => Promise.resolve({
        KeyDerivationId: insertRequest.keyDerivationId,
        DisplayCutoff: 0
      }),
      children: externalAddresses,
    },
    {
      index: 1,
      insert: insertRequest => Promise.resolve({
        KeyDerivationId: insertRequest.keyDerivationId,
        DisplayCutoff: null,
      }),
      children: internalAddresses,
    }
  ];
}

export async function createStandardCip1852Wallet(request: {
  db: lf$Database,
  discrimination: AddressDiscriminationType,
  rootPk: RustModule.WalletV3.Bip32PrivateKey,
  password: string,
  accountIndex: number,
  walletName: string,
  accountName: string,
}): Promise<HasConceptualWallet & HasCip1852Wrapper & HasRoot & HasPublicDeriver<mixed>> {
  if (request.accountIndex < HARD_DERIVATION_START) {
    throw new Error('createStandardCip1852Wallet needs hardened index');
  }

  const encryptedRoot = encryptWithPassword(
    request.password,
    request.rootPk.as_bytes()
  );

  const accountPublicKey = request.rootPk
    .derive(CIP_1852_PURPOSE)
    .derive(CARDANO_COINTYPE)
    .derive(request.accountIndex)
    .to_public();

  const initialDerivations = await getAccountDefaultDerivations(
    request.discrimination,
    accountPublicKey,
    rawGenAddByHash(new Set()),
  );

  const pathToPrivate = []; // private deriver level === root level
  let state;
  {
    state = await WalletBuilder
      .start(
        request.db,
        Bip44TableMap,
      )
      .addConceptualWallet(
        _finalState => ({
          CoinType: CARDANO_COINTYPE,
          Name: request.walletName,
        })
      )
      .addFromRoot(
        _finalState => ({
          rootInsert: {
            privateKeyInfo: {
              Hash: encryptedRoot,
              IsEncrypted: true,
              PasswordLastUpdate: null,
            },
            publicKeyInfo: null,
            derivationInfo: keys => ({
              PublicKeyId: keys.public,
              PrivateKeyId: keys.private,
              Parent: null,
              Index: null,
            }),
            levelInfo: insertRequest => Promise.resolve({
              KeyDerivationId: insertRequest.keyDerivationId,
            }),
          },
          tree: rootDerivation => ({
            derivationId: rootDerivation,
            children: [],
          }),
        })
      )
      .addCip1852Wrapper(
        finalState => ({
          ConceptualWalletId: finalState.conceptualWalletRow.ConceptualWalletId,
          SignerLevel: Bip44DerivationLevels.ROOT.level,
          PublicDeriverLevel: Bip44DerivationLevels.ACCOUNT.level,
          PrivateDeriverKeyDerivationId: finalState.root.root.KeyDerivation.KeyDerivationId,
          PrivateDeriverLevel: pathToPrivate.length,
        })
      )
      .derivePublicDeriver(
        finalState => {
          const id = finalState.cip1852WrapperRow.PrivateDeriverKeyDerivationId;
          const level = finalState.cip1852WrapperRow.PrivateDeriverLevel;
          if (id == null || level == null) {
            throw new Error('createStandardCip1852Wallet missing private deriver');
          }
          return {
            deriverRequest: {
              decryptPrivateDeriverPassword: request.password,
              publicDeriverMeta: {
                name: request.accountName,
              },
              path: [CIP_1852_PURPOSE, CARDANO_COINTYPE, request.accountIndex],
              initialDerivations,
            },
            privateDeriverKeyDerivationId: id,
            privateDeriverLevel: level,
          };
        }
      )
      .commit();
  }

  return state;
}