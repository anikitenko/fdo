import VirtualFS from "../../../../src/components/editor/utils/VirtualFS";

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
