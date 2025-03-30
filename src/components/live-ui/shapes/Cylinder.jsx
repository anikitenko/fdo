import PropTypes from "prop-types";

export const Cylinder = ({
                             label = "To Array",
                             fill = "#d4edda",
                             stroke = "#1e4620",
                             width = 140,
                             height = 80,
                             fontSize = 16,
                             strokeWidth = 2,
                         }) => {
    const w = width;
    const h = height;

    const rX = w / 2 - 10;
    const rY = Math.min(12, h / 8); // cap the ellipse height to 1/8 of total height

    const bodyTop = rY;
    const bodyBottom = h - rY;
    const bodyHeight = bodyBottom - bodyTop;
    const viewBox = `0 ${-strokeWidth} ${w} ${h + strokeWidth * 2}`;

    return (
        <svg width={w} height={h} viewBox={viewBox} shapeRendering="geometricPrecision" style={{ transform: 'translateY(1px)' }}>
            {/* Top ellipse */}
            <ellipse
                cx={w / 2}
                cy={rY}
                rx={rX}
                ry={rY}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
            />
            {/* Body */}
            <rect
                x={w / 2 - rX}
                y={bodyTop}
                width={rX * 2}
                height={bodyHeight}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
            />
            {/* Bottom ellipse */}
            <ellipse
                cx={w / 2}
                cy={h - rY}
                rx={rX}
                ry={rY}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
            />
            {/* Label */}
            <text
                x={w / 2}
                y={h / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight={600}
                fill={stroke}
                style={{ pointerEvents: "none" }}
            >
                {label}
            </text>
        </svg>
    );
}

Cylinder.propTypes = {
    label: PropTypes.string,
    fill: PropTypes.string,
    stroke: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
    fontSize: PropTypes.number,
    strokeWidth: PropTypes.number
}