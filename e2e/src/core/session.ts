import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { ConverterProgram } from "../../../on-chain/target/types/converter_program";
import * as anchor from "@coral-xyz/anchor";
import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec } from "child_process";
import { Program } from "@coral-xyz/anchor";
import idlJson from "../../../on-chain/target/idl/converter_program.json";
import {getConfig} from "./utils/config-util";

export enum SessionType {
    ADMIN = "admin",
    USER = "user"
}

export abstract class Session {
    private keypair: Keypair;
    protected executeDir: string;
    private rpcUrl: string;
    private sessionType: SessionType;
    private program: anchor.Program<ConverterProgram>;

    protected abstract getBinaryPath(): string;
    protected abstract getSessionType(): SessionType;

    constructor(keyPairPath?: string, rpcUrl: string = getConfig().rpc_url) {
        if (keyPairPath && keyPairPath.startsWith("~")) {
            keyPairPath = path.join(os.homedir(), keyPairPath.slice(1));
        }

        if (!keyPairPath || !fs.existsSync(keyPairPath!)) {
            const keypair = Keypair.generate();
            this.keypair = keypair;
        } else {
            this.keypair = Keypair.fromSecretKey(
                Uint8Array.from(
                    JSON.parse(
                        fs.readFileSync(keyPairPath, "utf8")
                    )
                )
            );
        }

        this.executeDir = this.getBinaryPath();
        this.rpcUrl = rpcUrl;
        this.sessionType = this.getSessionType();

        // Load the IDL
        const idl = idlJson as anchor.Idl;

        // Get the program
        const provider = new anchor.AnchorProvider(new anchor.web3.Connection(this.rpcUrl, "confirmed"), new anchor.Wallet(this.keypair), {
            commitment: "confirmed"
        });
        anchor.setProvider(provider);
        this.program = new anchor.Program(idl, provider);
    }

    public async logSessionInfo(): Promise<void> {
        console.log("--------------------------------");
        console.log(`${this.sessionType} Session Info`);
        console.log("RPC URL: ", this.rpcUrl);
        console.log("Keypair: ", this.keypair.publicKey.toBase58());
        console.log("Program ID: ", this.program.programId.toString());
        console.log("Execute Dir: ", this.executeDir);
        console.log("--------------------------------");
    }

    public async initialize(): Promise<void> {
        // Airdrop SOL to the keypair
        await this.program.provider.connection.requestAirdrop(this.keypair.publicKey, 100 * anchor.web3.LAMPORTS_PER_SOL);
    }

    public async executeCliCommand(command: string, optionalExecutablePath?: string): Promise<string> {
        const privateKey = this.keypair.secretKey.toString();
        const cliCommand = `export PRIVATE_KEY=${privateKey} && export DOUBLE_ZERO_CONFIG=./cli/config.json && ${optionalExecutablePath || this.executeDir} ${command}`;

        return new Promise((resolve, reject) => {
            exec(cliCommand, (error, stdout, stderr) => {
                if (error) {
                    const logs = [stdout, stderr].filter(Boolean).join("\n").trim();
                    reject(logs || error.message);
                    return;
                }
                const output = [stdout, stderr].filter(Boolean).join("\n").trim();
                resolve(output);
            });
        });
    }

    public getConnection(): Connection {
        return this.program.provider.connection;
    }

    public getProgram(): Program<ConverterProgram> {
        return this.program;
    }

    public getPublicKey(): PublicKey {
        return this.keypair.publicKey;
    }

    public getKeypair(): Keypair {
        return this.keypair;
    }
}