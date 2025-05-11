const { runCycleForAssociation } = require('./cycleService');
const { UserAssociation, Association, User } = require('../models');

jest.mock('../models');

describe('runCycleForAssociation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process the next user in the association', async () => {
    // Mock the user to be paid
    const mockUser = {
      id: 1,
      walletBalance: 100,
      save: jest.fn()
    };

    // Mock the association data
    const mockAssociation = {
      id: 1,
      monthlyAmount: 50,
      duration: 12
    };

    // Mock the user's participation in the association
    const mockUserAssociation = {
      UserId: 1,
      hasReceived: false,
      turnNumber: 1,
      save: jest.fn()
    };

    // Set up mocks for Sequelize calls
    UserAssociation.findAll.mockResolvedValue([mockUserAssociation]);
    Association.findByPk.mockResolvedValueOnce(mockAssociation);
    User.findByPk.mockResolvedValue(mockUser);

    // Run the function
    const result = await runCycleForAssociation(1);

    // Check returned result
    expect(result).toEqual({
      done: false,
      userId: 1,
      associationId: 1,
      amount: 600 // 50 * 12
    });

    // Check balance update
    expect(mockUser.walletBalance).toBe(700);
    expect(mockUser.save).toHaveBeenCalled();

    // Check user payout status
    expect(mockUserAssociation.hasReceived).toBe(true);
    expect(mockUserAssociation.save).toHaveBeenCalled();
    expect(mockUserAssociation.lastReceivedDate).toBeInstanceOf(Date);
  });

  it('should return done: true if no users are left to pay', async () => {
    UserAssociation.findAll.mockResolvedValue([]);

    const result = await runCycleForAssociation(1);

    expect(result).toEqual({ done: true });
  });
});

