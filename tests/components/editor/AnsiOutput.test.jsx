import React from "react";
import {render} from "@testing-library/react";
import {AnsiOutput} from "../../../src/components/editor/AnsiOutput";

test("renders Node reporter colors and resets without exposing escape codes", () => {
    const {container, getByText} = render(<AnsiOutput text={'\x1b[32m✔ works \x1b[90m(1ms)\x1b[39m\x1b[39m\n\x1b[34mℹ pass 1\x1b[39m\nplain'}/>);
    expect(container.textContent).toBe('✔ works (1ms)\nℹ pass 1\nplain');
    expect(getByText('✔ works')).toHaveStyle({color: '#7ee787'});
    expect(getByText('(1ms)')).toHaveStyle({color: '#8b949e'});
    expect(getByText('ℹ pass 1')).toHaveStyle({color: '#79c0ff'});
    expect(getByText('plain').style.color).toBe('');
});

test("keeps plugin output as text instead of interpreting HTML", () => {
    const {container} = render(<AnsiOutput text={'\x1b[31m<img src=x onerror=alert(1)>\x1b[0m'}/>);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('<img src=x onerror=alert(1)>');
});
