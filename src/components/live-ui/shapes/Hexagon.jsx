import PropTypes from "prop-types";

export const Hexagon = ({
                            label = "Condition",
                            width = 120,
                            height = 80,
                            fill = "#e6e0fa",
                            stroke = "#4b3f72",
                            strokeWidth = 2,
                            fontSize = 16,
                        }) => {
    const w = width;
    const h = height;
    const hw = w / 2;
    const hh = h / 2;
    const points = [
        `${0.25 * w},1`,
        `${0.75 * w},1`,
        `${w - 1},${hh}`,
        `${0.75 * w},${h - 1}`,
        `${0.25 * w},${h - 1}`,
        `1,${hh}`,
    ].join(" ");

    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges">
            <polygon
                points={points}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                strokeLinejoin="round"
                shapeRendering="geometricPrecision"
            />
            <text
                x={hw}
                y={hh}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight={600}
                fill={stroke}
            >
                {label}
            </text>
        </svg>
    );
}

Hexagon.propTypes = {
    label: PropTypes.string,
    fill: PropTypes.string,
    stroke: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
    fontSize: PropTypes.number,
    strokeWidth: PropTypes.number
}
