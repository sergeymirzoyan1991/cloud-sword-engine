import {AdapterInterface} from "./adapter-interface";
import {Configuration} from "../configuration";
import FindGarbageResponse from "../responses/find-garbage-response";
import FindGarbageDetailsResponse from "../responses/find-garbage-details-response";
import {GarbageItemInterface} from "../responses/garbage-item-interface";
import Ebs from "../domain/types/ebs";
import EbsGarbageItem from "../responses/ebs-garbage-item";
import DetachedVolumesResponse from "../responses/detached-volumes-response";
import { exec } from 'child_process';
const yaml = require('js-yaml');
const fs  = require('fs');
import * as policies from "../policy.json";

export class ShellAdapter implements AdapterInterface {
    private readonly custodian: String

    constructor(custodian: String) {
        this.custodian = custodian;
    }

    findGarbage(config: Configuration): FindGarbageResponse {
        const detachedVolumesResponse = this.findDetachedVolumes(config);
        return new FindGarbageResponse(detachedVolumesResponse.count);
    }

    findGarbageDetails(config: Configuration): FindGarbageDetailsResponse {
        let items: Array<GarbageItemInterface> = new Array<GarbageItemInterface>();

        let detachedVolumesResponse = this.findDetachedVolumes(config);
        detachedVolumesResponse.items.forEach((ebs: Ebs) => {
            items.push(EbsGarbageItem.fromEbs(ebs))
        })

        return new FindGarbageDetailsResponse(items);
    }

    findDetachedVolumes(config: Configuration): DetachedVolumesResponse {
        const policyName = "ebs-collect-unattached";
        const policy: any = Object.assign({}, policies[policyName]);

        // execute custodian command
        const responseJson = this.executeCustodianCommand(config, policy, policyName);

        // remove temp files and folders
        this.removeTempFoldersAndFiles(policyName);

        return new DetachedVolumesResponse(responseJson.map((ebsResponseItemJson: { VolumeId: string; Size: number; AvailabilityZone: string; CreateTime: string; })  => {
            return new Ebs(
                ebsResponseItemJson.VolumeId,
                ebsResponseItemJson.Size,
                ebsResponseItemJson.AvailabilityZone,
                ebsResponseItemJson.CreateTime
            )
        }));
    }

    deleteDetachedVolumes(config: Configuration, volumes: string[]): DetachedVolumesResponse {
        const policyName = "delete-unattached-volumes";
        const policy: any = Object.assign({}, policies[policyName]);
        if (volumes.length) {
            policy["policies"][0]["filters"] = [
                {
                    VolumeId: volumes[0]
                }
            ];
        } else {
            policy["policies"][0]["filters"] = [
                {
                    Attachments: []
                },
                {
                    State: "available"
                }
            ];
        }

        // execute custodian command
        const responseJson = this.executeCustodianCommand(config, policy, policyName);

        // remove temp files and folders
        this.removeTempFoldersAndFiles(policyName);

        //check validate response

        return new DetachedVolumesResponse(responseJson.map((ebsResponseItemJson: { VolumeId: string; Size: number; AvailabilityZone: string; CreateTime: string; })  => {
            return new Ebs(
                ebsResponseItemJson.VolumeId,
                ebsResponseItemJson.Size,
                ebsResponseItemJson.AvailabilityZone,
                ebsResponseItemJson.CreateTime
            )
        }));
    }

    removeTempFoldersAndFiles(policyName: string) {
        if (!fs.existsSync(`./${policyName}`)) {
            exec(`rm -r ./${policyName}`);
        }
        if (!fs.existsSync(`./temp.yaml`)) {
            exec(`rm ./temp.yaml`);
        }
    }

    executeCustodianCommand(config: Configuration, policy: any, policyName: string) {
        fs.writeFileSync('./temp.yaml', yaml.dump(policy), 'utf8');
        exec(`AWS_DEFAULT_REGION=${config.region} AWS_ACCESS_KEY_ID=${config.accessKeyId} AWS_SECRET_ACCESS_KEY=${config.secretAccessKey} ${this.custodian} run --output-dir=.  temp.yaml`,
            (error, stdout: any, stderr: any) => {
                if (error) {
                    throw new Error(error.message);
                }
            });
        const resourcesPath = `./${policyName}/resources.json`;
        if (!fs.existsSync(resourcesPath)) {
            throw new Error('asdasd');
        }
        return JSON.parse(fs.readFileSync(resourcesPath, 'utf8'));
    }
}