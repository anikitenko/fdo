import {KBarAnimator, KBarPortal, KBarPositioner, KBarResults, KBarSearch, useKBar, useMatches} from "kbar";
import React, {useEffect, useMemo} from "react";
import PropTypes from "prop-types";

const searchStyle = {
    padding: "12px 16px",
    fontSize: "14px",
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    border: "none",
    background: "#2e2e2e",
    color: "white",
};

const animatorStyle = {
    maxWidth: "600px",
    width: "100%",
    background: "#2e2e2e",
    color: "white",
    borderRadius: "8px",
    overflow: "hidden",
    boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.2), 0 1px 1px 0 rgba(17, 20, 24, 0.4)",
};

const groupNameStyle = {
    padding: "8px 16px",
    fontSize: "12px",
    textTransform: "uppercase",
    opacity: 0.5,
};

const RenderResults = () => {
    const {results, rootActionId} = useMatches();

    return (
        <KBarResults
            items={results}
            onRender={({item, active}) =>
                typeof item === "string" ? (
                    <div style={groupNameStyle}>{item}</div>
                ) : (
                    <ResultItem
                        action={item}
                        active={active}
                        currentRootActionId={rootActionId}
                    />
                )
            }
        />
    );
}

const ResultItem = React.forwardRef(
    (
        {
            action,
            active,
            currentRootActionId,
        }, ref
    ) => {
        const ancestors = useMemo(() => {
            if (!currentRootActionId) return action.ancestors;
            const index = action.ancestors.findIndex(
                (ancestor) => ancestor.id === currentRootActionId
            );
            // +1 removes the currentRootAction; e.g.
            // if we are on the "Set theme" parent action,
            // the UI should not display "Set theme… > Dark"
            // but rather just "Dark"
            return action.ancestors.slice(index + 1);
        }, [action.ancestors, currentRootActionId]);

        return (
            <div
                ref={ref}
                style={{
                    padding: "12px 16px",
                    background: active ? "var(--a1)" : "transparent",
                    borderLeft: `2px solid ${
                        active ? "var(--foreground)" : "transparent"
                    }`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    cursor: "pointer",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        fontSize: 14,
                    }}
                >
                    {action.icon? action.icon : ""}
                    <div style={{display: "flex", flexDirection: "column"}}>
                        <div>
                            {ancestors.length > 0 &&
                                ancestors.map((ancestor) => (
                                    <React.Fragment key={ancestor.id}>
                    <span
                        style={{
                            opacity: 0.5,
                            marginRight: 8,
                        }}
                    >
                      {ancestor.name}
                    </span>
                                        <span
                                            style={{
                                                marginRight: 8,
                                            }}
                                        >
                      &rsaquo;
                    </span>
                                    </React.Fragment>
                                ))}
                            <span>{action.name}</span>
                        </div>
                        {action.subtitle && (
                            <span style={{fontSize: 12}}>{action.subtitle}</span>
                        )}
                    </div>
                </div>
                {action.shortcut?.length ? (
                    <div
                        aria-hidden
                        style={{display: "grid", gridAutoFlow: "column", gap: "4px"}}
                    >
                        {action.shortcut.map((sc) => (
                            <kbd
                                key={sc}
                                style={{
                                    padding: "4px 6px",
                                    background: "rgba(0 0 0 / .1)",
                                    borderRadius: "4px",
                                    fontSize: 14,
                                }}
                            >
                                {sc}
                            </kbd>
                        ))}
                    </div>
                ) : null}
            </div>
        );
    }
);
ResultItem.propTypes = {
    action: PropTypes.object,
    active: PropTypes.bool,
    currentRootActionId: PropTypes.string
}

export const CommandBar = ({show, actions, setShow}) => {
    const {query} = useKBar();

    useEffect(() => {
        // Store cleanup function from previous action registration
        const unregister = query.registerActions(actions);

        // Cleanup: Unregister previous actions when searchActions changes
        return () => {
            unregister();
        };
    }, [actions]);

    useEffect(() => {
        if (show) {
            setShow(false)
            query.toggle()
        }
    }, [show]);
    return (
        <KBarPortal>
            <KBarPositioner>
                <KBarAnimator style={animatorStyle}>
                    <KBarSearch style={searchStyle}/>
                    <RenderResults/>
                </KBarAnimator>
            </KBarPositioner>
        </KBarPortal>
    );
}
CommandBar.propTypes = {
    show: PropTypes.bool,
    actions:  PropTypes.array,
    setShow: PropTypes.func
}
