import React from 'react';
import { useDnD } from './DnDContext.jsx';
import classnames from "classnames";

import * as styles from "../css/LiveUI.module.css"
import {RoundedRectangle} from "./shapes/RoundedRectangle.jsx";
import {Cylinder} from "./shapes/Cylinder.jsx";
import {Diamond} from "./shapes/Diamond.jsx";
import {Hexagon} from "./shapes/Hexagon.jsx";

export default () => {
    const [_, setType] = useDnD();

    const onDragStart = (event, nodeType) => {
        setType(nodeType);
        event.currentTarget.classList.add(styles['dragging']);
        event.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div className={styles.nodeHelpers}>
            <div>
                <span className={"bp6-heading"} style={{fontStyle: "1rem"}}>Helper nodes:</span>
            </div>
            <div className={classnames(styles["helperItem"])} draggable={true} onDragStart={(event) => onDragStart(event, 'concat')} onDragEnd={(e) => {
                e.currentTarget.classList.remove(styles['dragging']);
            }}>
                <RoundedRectangle />
            </div>
            <div className={classnames(styles["helperItem"])} draggable={true} onDragStart={(event) => onDragStart(event, 'toArray')} onDragEnd={(e) => {
                e.currentTarget.classList.remove(styles['dragging']);
            }}>
                <Cylinder width={120} />
            </div>
            <div className={classnames(styles["helperItem"])} draggable={true} onDragStart={(event) => onDragStart(event, 'ifExpr')} onDragEnd={(e) => {
                e.currentTarget.classList.remove(styles['dragging']);
            }}>
                <Diamond width={60} height={60} />
            </div>
            <div className={classnames(styles["helperItem"])} draggable={true} onDragStart={(event) => onDragStart(event, 'ifCondition')} onDragEnd={(e) => {
                e.currentTarget.classList.remove(styles['dragging']);
            }}>
                <Hexagon />
            </div>
        </div>
    );
};
