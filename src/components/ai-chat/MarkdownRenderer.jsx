import React, {useEffect} from "react";
import Markdown from 'markdown-to-jsx'

import * as styles from "./MarkdownRenderer.module.scss";
import classnames from "classnames";

export default function MarkdownRenderer({ skeleton, text, attachments, role }) {
    let newText = text;
    if (attachments) {
        newText = text + "\n\n" + attachments
    }
    return (
        <div className={classnames(skeleton ? 'bp6-skeleton' : styles["markdown-body"], role !== "user" && "markdown-body")}>
            <Markdown>
                {newText}
            </Markdown>
        </div>
    );
}