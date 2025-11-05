import React from "react";
import Markdown from 'markdown-to-jsx'

import * as styles from "./MarkdownRenderer.module.scss";
import classnames from "classnames";

export default function MarkdownRenderer({ skeleton, text, role }) {
    return (
        <div className={classnames(skeleton ? 'bp6-skeleton' : '', role !== "user" && styles["markdown-body"], role !== "user" && "markdown-body")}>
            <Markdown>{text}</Markdown>
        </div>
    );
}