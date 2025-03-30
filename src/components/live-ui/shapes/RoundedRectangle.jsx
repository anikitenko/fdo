import PropTypes from "prop-types";

export const RoundedRectangle = ({
                                     label = "Concat",
                                     width = 140,
                                     height = 60,
                                     fill = "#d1e8ff",
                                     stroke = "#003366",
                                     strokeWidth = 2,
                                     fontSize = 16,
                                     radius = 12
                                 }) => {
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} shapeRendering="geometricPrecision">
            <rect
                x="1"
                y="1"
                width={width - 2}
                height={height - 2}
                rx={radius}
                ry={radius}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
            />
            <text
                x={width / 2}
                y={height / 2}
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

RoundedRectangle.propTypes = {
    label: PropTypes.string,
    fill: PropTypes.string,
    stroke: PropTypes.string,
    width: PropTypes.number,
    height: PropTypes.number,
    fontSize: PropTypes.number,
    radius: PropTypes.number,
    strokeWidth: PropTypes.number
}