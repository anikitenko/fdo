import {Button, Tag} from "@blueprintjs/core";

export const NavigationPluginsButton = ({countEnabled, countDisabled}) => {
    return (
        <Button
            alignText="left"
            minimal={true}
            rightIcon={"caret-down"}
            text={"Plugins "}
        ><Tag intent={"success"} round={true}>{countEnabled}</Tag> <Tag intent={"danger"} round={true}>{countDisabled}</Tag></Button>
    );
};
