import VirtualFS from "../../../../src/components/editor/utils/VirtualFS";

// Jest requires ES module support. Add this pragma to enable it.
// @jest-environment jsdom

describe('VirtualFS Tests', () => {
    let fs;

    beforeEach(() => {
        fs = VirtualFS;
        fs.setTreeObjectItemRoot("test")
    });

    it('should create a first', () => {
        fs.createFile('test.txt', "test")
    })
})
