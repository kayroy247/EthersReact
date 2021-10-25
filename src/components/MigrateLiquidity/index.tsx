import React, { useState, useEffect } from "react";
import { Pair, TokenAmount, Fetcher, Percent } from "@uniswap/sdk";
import { BigNumber } from "@ethersproject/bignumber";
import { ethers } from "ethers";
import { splitSignature } from "@ethersproject/bytes";
import { Contract } from "@ethersproject/contracts";
import { toast } from "react-toastify";
import Input from "../Input";
import { useLocalStorage } from "../../hooks/useStorage";
import { transactionConstraint } from "../../constants/index";
import { useLiquidityAmount } from "../../state/liquidity/hooks";
import {
  formatBalance,
  tokenObject,
  getContract,
  getDeadline,
} from "../../utils";
import {
  usePairContract,
  useSushiRoll,
  useV2FactoryContract,
} from "../../hooks/useContracts";
import KovanTokenList from "../../constants/tokenLists/kovanTokenList.json";
import UniswapPairAbi from "../../constants/abi/UniswapPair.json";
import { useActiveWeb3React } from "../../hooks";
import { parseUnits } from "@ethersproject/units";
import { SUSHI_ROLL } from "../../constants";
import { sign } from "crypto";

function MigrateLiquidity() {
  const { library, account, chainId } = useActiveWeb3React();
  const [deadline, setDeadline] = useLocalStorage(
    transactionConstraint.deadline,
    10
  );
  const [slippage, setSlippage] = useLocalStorage(
    transactionConstraint.slippage,
    1.5
  );
  const liquidity = useLiquidityAmount();
  const [liquidityAmount, setLiquidityAmount] = useState("");

  const [loading, setLoading] = useState(false);
  const sushiRollContract = useSushiRoll();

  const factory = useV2FactoryContract();

  const [pairContract, setPairContract] = useState<any>();
  const [LP, setLP] = useState("");
  const [token0Symbol, setToken0Symbol] = useState<string | undefined>("");
  const [token1Symbol, setToken1Symbol] = useState<string | undefined>("");
  const [token0Amount, setToken0Amount] = useState<string | undefined>("");
  const [token1Amount, setToken1Amount] = useState<string | undefined>("");
  const [signatureData, setSignatureData] = useState<{
    v: number;
    r: string;
    s: string;
    deadline: number;
  } | null>(null);

  const [error, setError] = useState("");
  const [approvedPair, setApprovedPair] = useState(false);
  const userPairContract: Contract | null = usePairContract(liquidity.address);

  useEffect(() => {
    if (liquidity?.amount) {
      migrate();
      checkAllowance();
    }
  }, [liquidity]);
  const migrate = async () => {
    setLoading(true);
    const [tokenZero, tokenOne] = findSelectedLP();
    const Token0 = tokenObject(tokenZero);
    const Token1 = tokenObject(tokenOne);
    const PairData = await Fetcher.fetchPairData(Token0, Token1);
    // const PairContract = getContract(
    //   PairData.liquidityToken.address,
    //   UniswapPairAbi,
    //   library,
    //   account
    // );
    setPairContract(PairData);

    const token00 = PairData.reserve0.token;
    const token11 = PairData.reserve1.token;
    // const [token00Amount, token11Amount] = await PairContract.getReserves();

    const tokenAAmount = PairData.getLiquidityValue(
      token00,
      new TokenAmount(PairData.liquidityToken, liquidity.totalSupply),
      new TokenAmount(PairData.liquidityToken, liquidity.amount)
    );
    const tokenBAmount = PairData.getLiquidityValue(
      token11,
      new TokenAmount(PairData.liquidityToken, liquidity.totalSupply),
      new TokenAmount(PairData.liquidityToken, liquidity.amount)
    );
    setToken0Symbol(tokenAAmount.token.symbol);
    setToken1Symbol(tokenBAmount.token.symbol);
    setToken0Amount(tokenAAmount.toFixed(4));
    setToken1Amount(tokenBAmount.toFixed(4));

    console.log(
      tokenAAmount.toFixed(4),
      tokenAAmount.token.symbol,
      tokenBAmount.toFixed(4),
      tokenBAmount.token.symbol
    );
    setLoading(false);
  };
  const handleLPInput = (event: any) => {
    setError("");
    setLiquidityAmount(event?.target?.value);

    const LP = formatBalance(liquidity.amount);
    if (
      Number(event.target.value) !== 0 &&
      BigNumber.from(event.target.value).gt(liquidity.amount)
    ) {
      setError("Insufficient LP balance");
    } else {
      const percent = new Percent(
        event.target.value,
        liquidity.amount.toString()
      );
      console.log(percent.toFixed(2), event.target.value);
    }
  };
  const findSelectedLP = () => {
    const [token1, token0] = KovanTokenList.tokens.filter((token) => {
      return (
        token.address === liquidity.token0 || token.address === liquidity.token1
      );
    });
    setLP(`${token1.symbol}/${token0.symbol}`);
    return [token1, token0];
  };

  const migrateUserLiquidity = async () => {
    if (!liquidityAmount) {
      return setError("please enter an amount");
    }
    try {
      const [tokenZero, tokenOne] = findSelectedLP();
      const ratio = Number(liquidityAmount) / formatBalance(liquidity.amount);
      const slippageRatio = (100 - Number(slippage)) / 100;
      console.log(ratio);
      const AmountToken0 = ratio * Number(token0Amount) * slippageRatio;
      const AmountToken1 = ratio * Number(token1Amount) * slippageRatio;
      const userLiquidity = parseUnits(liquidityAmount);
      await sushiRollContract?.migrate(
        tokenZero.address,
        tokenOne.address,
        userLiquidity,
        0,
        0,
        getDeadline()
      );
    } catch (error) {
      console.log(error);
    }
  };
  const approveLPToken = async () => {
    try {
      const approvalAmount = ethers.utils.parseUnits("900000000", 18);
      const tx = await userPairContract?.approve(SUSHI_ROLL, approvalAmount);
      setApprovedPair(true);
      const receipt = await tx.wait(3);
      console.log(receipt);
      if (receipt?.status) toast("Successfully Approved LP Token");
    } catch (error) {
      console.log(error);
    }
  };

  const checkAllowance = async () => {
    try {
      const allowance = await userPairContract?.allowance(account, SUSHI_ROLL);
      console.log(liquidity?.amount.lt(allowance));
      if (liquidity?.amount.lt(allowance)) {
        setApprovedPair(true);
      } else {
        setApprovedPair(false);
      }
    } catch (error) {
      console.log(error);
    }
  };

  async function permit() {
    if (!pairContract || !library || !getDeadline() || !account)
      throw new Error("missing dependencies");
    const userLiquidityAmount = liquidityAmount;

    console.log(pairContract.address, liquidity.address);

    if (!liquidityAmount) return setError("Please enter an amount");

    // try to gather a signature for permission
    const nonce = await userPairContract?.nonces(account);
    const deadline = Number(getDeadline());
    const EIP712Domain = [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ];
    const domain = {
      name: "Uniswap V2",
      version: "1",
      chainId: chainId,
      verifyingContract: liquidity.address,
    };
    const Permit = [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ];
    const message = {
      owner: account,
      spender: SUSHI_ROLL,
      value: 100000000000000,
      nonce: nonce.toHexString(),
      deadline,
    };
    const data = JSON.stringify({
      types: {
        EIP712Domain,
        Permit,
      },
      domain,
      primaryType: "Permit",
      message,
    });

    library
      .send("eth_signTypedData_v4", [account, data])
      .then(ethers.utils.splitSignature)
      .then((signature: any) => {
        setSignatureData({
          v: signature.v,
          r: signature.r,
          s: signature.s,
          deadline,
        });
      })
      .catch((error: any) => {
        // for all errors other than 4001 (EIP-1193 user rejected request), fall back to manual approve
        console.log(error);
        if (error?.code !== 4001) {
          console.log("user rejected request");
        }
      });
  }

  const migrateWithPermit = async () => {
    if (!liquidityAmount) {
      return setError("please enter an amount");
    }
    if (!signatureData) {
      throw new Error("No signature Data");
    }
    const [tokenZero, tokenOne] = findSelectedLP();
    const { v, r, s, deadline } = signatureData;
    console.log(
      tokenOne.address,
      tokenZero.address,
      100000000000000,
      0,
      0,
      deadline,
      v,
      r,
      s
    );
    try {
      await sushiRollContract?.migrateWithPermit(
        tokenZero.address,
        tokenOne.address,
        100000000000000,
        0,
        0,
        signatureData?.deadline,
        v,
        r,
        s,
        { gasLimit: 3500000 }
      );
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <div>
      <div className="p-4">
        {loading ? <div>Loading...</div> : null}
        {token0Symbol ? (
          <div className="container my-4 rounded mx-auto p-4 bg-gray-200">
            <p>Your Position</p>
            <p className="flex justify-between ...">
              <span> {`${token0Symbol}/${token1Symbol}`}</span>

              <span>{formatBalance(liquidity.amount)}</span>
            </p>
            <p className="flex justify-between ...">
              <span> {`${token0Symbol}`}</span>

              <span>{token0Amount}</span>
            </p>

            <p className="flex justify-between ...">
              <span> {`${token1Symbol}`}</span>

              <span>{token1Amount}</span>
            </p>
            <p>
              <Input
                type="number"
                value={liquidityAmount}
                onChange={handleLPInput}
                placeholder="amount of LP token to migrate"
              />
              <div className="text-red-600 font-light">
                {error ? `${error}` : null}
              </div>
              <p>Migrate</p>
              <div className="flex flex-row">
                <button
                  type="button"
                  disabled={loading || !!error}
                  onClick={approveLPToken}
                  className={`font-bold p-2 flex-grow text-bold text-white border rounded transition duration-300 ${
                    approvedPair ? "bg-gray-500" : "bg-blue-700"
                  }`}
                >
                  {loading ? " Loading..." : "Approve"}
                </button>

                <button
                  type="button"
                  disabled={loading || !!error}
                  onClick={migrateUserLiquidity}
                  className={`font-bold p-2 flex-grow text-bold text-white border rounded transition duration-300 ${
                    approvedPair ? "bg-blue-700" : "bg-gray-500"
                  }`}
                >
                  {loading ? " Loading..." : "Migrate"}
                </button>
              </div>
              <div className="flex justify-center m-5"> OR</div>
              <p>Sign and Migrate</p>
              <div className="flex flex-row">
                <button
                  type="button"
                  disabled={loading || !!error}
                  onClick={permit}
                  className={`font-bold p-2 flex-grow text-bold text-white border rounded transition duration-300 ${
                    signatureData ? "bg-gray-500" : "bg-blue-700"
                  }`}
                >
                  {loading ? " Loading..." : "Sign"}
                </button>

                <button
                  type="button"
                  disabled={loading || !!error}
                  onClick={migrateWithPermit}
                  className={`font-bold p-2 flex-grow text-bold text-white border rounded transition duration-300 ${
                    signatureData ? "bg-blue-700" : "bg-gray-500"
                  }`}
                >
                  {loading ? " Loading..." : "Migrate with Permit"}
                </button>
              </div>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default MigrateLiquidity;
