import {MenuDivider, MenuItem, Menu, NonIdealState, KeyComboTag} from "@blueprintjs/core";
import React, {useEffect, useMemo, useState} from "react";
import {Omnibar} from "@blueprintjs/select";
import PropTypes from "prop-types";

import * as styles from './css/CommandBar.module.css'
import {debounce} from "lodash";
import classNames from "classnames";

function highlightText(text, query) {
    if (!query) {
        return text;
    }

    const normalizedText = text.toLowerCase();
    const normalizedQuery = query.toLowerCase();

    const parts = [];

    let lastIndex = 0;
    let matchIndex = normalizedText.indexOf(normalizedQuery);

    while (matchIndex !== -1) {
        if (matchIndex > lastIndex) {
            parts.push(text.substring(lastIndex, matchIndex));
        }

        parts.push(
            <strong key={matchIndex} style={{ fontWeight: 600 }}>
                {text.substring(matchIndex, matchIndex + query.length)}
            </strong>
        );

        lastIndex = matchIndex + query.length;
        matchIndex = normalizedText.indexOf(normalizedQuery, lastIndex);
    }

    if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
    }

    return <>{parts}</>;
}

const renderAction = (action, { handleClick, modifiers, query }) => {
    const highlightedTitle = highlightText(action.name, query);
    const highlightedSubtitle = action.subtitle ? highlightText(action.subtitle, query) : null;

    return (
        <MenuItem
            key={action.id}
            text={
                <div style={{ display: "flex", flexDirection: "column" }}>
                    <div>{highlightedTitle}</div>
                    {highlightedSubtitle && (
                        <div style={{ fontSize: "12px", opacity: 0.7, marginTop: "2px" }}>
                            {highlightedSubtitle}
                        </div>
                    )}
                </div>
            }
            labelElement={
                action.shortcut ? <KeyComboTag combo={action.shortcut} /> : undefined
            }
            icon={action.icon}
            active={modifiers.active}
            onClick={handleClick}
        />
    );
};

const SECTION_PRIORITY = {
    "Installed Plugins": 0,
    // You can add more special priorities here later
};

function groupActionsBySection(actions) {
    const grouped = actions.reduce((acc, action) => {
        const section = action.section || "Other";
        if (!acc[section]) {
            acc[section] = [];
        }
        acc[section].push(action);
        return acc;
    }, {});

    // Sort actions inside each section alphabetically by name
    Object.keys(grouped).forEach(section => {
        grouped[section].sort((a, b) => a.name.localeCompare(b.name));
    });

    return grouped;
}

function itemListRenderer({
                              items,
                              query,
                              renderItem,
                          }) {
    const normalizedQuery = query.toLowerCase();

    const filteredItems = items.filter(action => {
        if (!action) return false;
        const keywords = Array.isArray(action.keywords) ? action.keywords : [];

        return (
            action.name.toLowerCase().includes(normalizedQuery) ||
            keywords.some(keyword => keyword.toLowerCase().includes(normalizedQuery))
        );
    });

    if (filteredItems.length === 0) {
        return (
            <div style={{ padding: "20px" }}>
                <NonIdealState
                    icon="search"
                    title="No commands found"
                    description="Try typing different keywords."
                    layout="vertical"
                />
            </div>
        );
    }

    const grouped = groupActionsBySection(filteredItems);

    return (
        <Menu>
            {Object.entries(grouped)
                .sort(([sectionA], [sectionB]) => {
                    const priorityA = SECTION_PRIORITY[sectionA] ?? Infinity;
                    const priorityB = SECTION_PRIORITY[sectionB] ?? Infinity;
                    if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                    }
                    return sectionA.localeCompare(sectionB);
                })
                .map(([section, sectionActions]) => (
                    <React.Fragment key={section}>
                        <MenuDivider title={section} />
                        {sectionActions.map((action, index) => renderItem(action, index))}
                    </React.Fragment>
                ))}
        </Menu>
    );
}

function renderGroupedInitialContent(actions, onSelect) {
    const grouped = groupActionsBySection(actions);

    return (
        <Menu>
            {Object.entries(grouped)
                .sort(([sectionA], [sectionB]) => {
                    const priorityA = SECTION_PRIORITY[sectionA] ?? Infinity;
                    const priorityB = SECTION_PRIORITY[sectionB] ?? Infinity;

                    if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                    }
                    return sectionA.localeCompare(sectionB);
                })
                .map(([section, sectionActions]) => (
                    <React.Fragment key={section}>
                        <MenuDivider title={section} />
                        {sectionActions.map(action => (
                            <MenuItem
                                key={action.id}
                                text={action.name}
                                label={action.subtitle}
                                icon={action.icon}
                                onClick={() => onSelect(action)}
                            />
                        ))}
                    </React.Fragment>
                ))}
        </Menu>
    );
}

export const CommandBar = ({show, actions, setShow}) => {
    const [query, setQuery] = useState("");

    const debouncedSetQuery = useMemo(() => debounce(setQuery, 150), [setQuery]);

    useEffect(() => {
        return () => {
            debouncedSetQuery.cancel();
        };
    }, [debouncedSetQuery]);

    return (
        <Omnibar
            className={classNames(styles["commandBarOmnibar"], "bp6-dark")}
            isOpen={show}
            items={actions}
            itemRenderer={renderAction}
            itemListRenderer={itemListRenderer}
            onItemSelect={(item) => {
                item.perform();
                setShow(false);
            }}
            onClose={() => setShow(false)}
            resetOnSelect
            initialContent={renderGroupedInitialContent(actions, (action) => {
                action.perform();
                setShow(false);
            })}
            inputProps={{
                leftIcon: "search",
                placeholder: "Search commands...",
            }}
            query={query}
            onQueryChange={debouncedSetQuery}
        />
    );
}
CommandBar.propTypes = {
    show: PropTypes.bool,
    actions: PropTypes.array,
    setShow: PropTypes.func
}
