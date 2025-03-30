import PropTypes from "prop-types";

export const Diamond = ({
                            label = "IF",
                            width = 45,
                            height = 45,
                            fill = "#fff3cd",
                            stroke = "#856404",
                            strokeWidth = 2,
                            fontSize = 16,
                        }) => {
    const w = width;
    const h = height;
    const cx = w / 2;
    const cy = h / 2;

    const points = [
        `${cx},1`,      // top
        `${w - 1},${cy}`, // right
        `${cx},${h - 1}`, // bottom
        `1,${cy}`       // left
    ].join(" ");
    return (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges">
            <polygon points={points} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round"
                     shapeRendering="geometricPrecision"/>
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={fontSize} fontWeight={600}
                  fill={stroke}>
                {label}
            </text>
        </svg>
    )
}

Diamond.propTypes = {
    label: PropTypes.string,
    fill: PropTypes.string,
    stroke: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
    fontSize: PropTypes.number,
    strokeWidth: PropTypes.number
}
